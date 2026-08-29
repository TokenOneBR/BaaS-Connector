import {
  BreakType,
  MatchConfidence,
  ReconciliationSide,
  TransactionStatus,
} from '@baasconn/taxonomy';
import { describe, expect, it } from 'vitest';

import { reconcile } from './engine.js';
import { input, item } from './test-support.js';
import type { ReconciliationInput } from './types.js';

const LTX = 'ltx_01JBQ8Z2K3LEDGERTXN00001';

/**
 * Um dia inteiro numa conta, com um caso de cada passe. Existe para provar
 * que os cinco passes convivem — cada um consumindo do pool que o anterior
 * deixou — e nao so que cada um funciona isolado.
 */
function diaCompleto(): ReconciliationInput {
  return input({
    provider: [
      // passe 1: chave forte, casa exato
      item({
        id: 'pit_forte',
        side: ReconciliationSide.PROVIDER,
        endToEndId: 'E1801234520260310100011111111',
        amountCents: 150_000n,
      }),
      // passe 2: mesmo balde fuzzy
      item({ id: 'pit_fuzzy', side: ReconciliationSide.PROVIDER, amountCents: 33_300n }),
      // passe 3: dentro da tolerancia de valor
      item({ id: 'pit_janela', side: ReconciliationSide.PROVIDER, amountCents: 77_701n }),
      // orfao: credito, propoe importacao
      item({ id: 'pit_orfao', side: ReconciliationSide.PROVIDER, amountCents: 12_345n }),
    ],
    local: [
      item({
        id: 'txn_forte',
        side: ReconciliationSide.LOCAL,
        endToEndId: 'E1801234520260310100011111111',
        amountCents: 150_000n,
        ledgerTransactionId: LTX,
      }),
      item({ id: 'txn_fuzzy', side: ReconciliationSide.LOCAL, amountCents: 33_300n }),
      item({ id: 'txn_janela', side: ReconciliationSide.LOCAL, amountCents: 77_700n }),
      // so nosso: vira MISSING_ON_PROVIDER
      item({
        id: 'txn_sozinho',
        side: ReconciliationSide.LOCAL,
        amountCents: 99_900n,
        direction: 'DEBIT',
        status: TransactionStatus.SETTLED,
      }),
    ],
    ledger: [
      item({
        id: 'len_forte',
        side: ReconciliationSide.LEDGER,
        ledgerTransactionId: LTX,
        amountCents: 150_000n,
      }),
    ],
  });
}

describe('motor', () => {
  it('cada passe casa o seu, e os contadores fecham', () => {
    const resultado = reconcile(diaCompleto());
    const porPasse = new Map(resultado.matches.map((m) => [m.pass, m]));

    expect(porPasse.get(1)?.providerItemId).toBe('pit_forte');
    expect(porPasse.get(1)?.confidence).toBe(MatchConfidence.EXACT);
    expect(porPasse.get(2)?.providerItemId).toBe('pit_fuzzy');
    expect(porPasse.get(3)?.providerItemId).toBe('pit_janela');
    expect(porPasse.get(3)?.confidence).toBe(MatchConfidence.LOW);

    expect(resultado.counters).toMatchObject({
      providerItemCount: 4,
      localItemCount: 4,
      ledgerItemCount: 1,
      matchedCount: 3,
    });
    expect(resultado.counters.breakCount).toBe(resultado.breaks.length);
  });

  it('as quebras restantes sao exatamente as esperadas', () => {
    const resultado = reconcile(diaCompleto());
    const resumo = resultado.breaks
      .map((b) => `${b.type}:${b.providerItemId ?? b.localItemId ?? b.ledgerItemId}`)
      .sort();

    expect(resumo).toEqual([
      // o par do passe 2 nao tem ligacao com o razao
      `${BreakType.MISSING_ON_LEDGER}:txn_fuzzy`,
      `${BreakType.MISSING_ON_LEDGER}:txn_janela`,
      `${BreakType.MISSING_ON_LOCAL}:pit_orfao`,
      `${BreakType.MISSING_ON_PROVIDER}:txn_sozinho`,
    ]);
  });

  it('e deterministico: a mesma janela conciliada duas vezes da o mesmo plano', () => {
    const a = reconcile(diaCompleto());
    const b = reconcile(diaCompleto());
    expect(JSON.stringify(a, substituirBigInt)).toBe(JSON.stringify(b, substituirBigInt));
  });

  it('a ordem de entrada nao muda o plano', () => {
    const direto = diaCompleto();
    const invertido: ReconciliationInput = {
      ...direto,
      provider: [...direto.provider].reverse(),
      local: [...direto.local].reverse(),
    };

    const a = reconcile(direto);
    const b = reconcile(invertido);
    expect(chaves(a.matches)).toEqual(chaves(b.matches));
    expect(a.breaks.map((x) => x.dedupeKey).sort()).toEqual(
      b.breaks.map((x) => x.dedupeKey).sort(),
    );
  });

  it('devolve um plano e nao efeitos: nao muta a entrada', () => {
    // E o que torna possivel rodar contra a janela de ontem em producao e VER
    // as quebras que o motor abriria, sem escrever uma linha.
    const entrada = diaCompleto();
    const antes = JSON.stringify(entrada, substituirBigInt);
    reconcile(entrada);
    expect(JSON.stringify(entrada, substituirBigInt)).toBe(antes);
  });

  it('toda quebra tem chave de dedup nao vazia', () => {
    // A coluna e NOT NULL, e a dedup so funciona porque a chave e derivada.
    const resultado = reconcile(diaCompleto());
    expect(resultado.breaks.length).toBeGreaterThan(0);
    for (const quebra of resultado.breaks) {
      expect(quebra.dedupeKey).toMatch(/^(e2e|bal|pitem|litem|acct):.+/);
    }
  });

  it('nenhuma evidencia carrega bigint — a coluna e Json e stringify lancaria', () => {
    const resultado = reconcile(diaCompleto());
    for (const quebra of resultado.breaks) {
      expect(() => JSON.stringify(quebra.evidence)).not.toThrow();
    }
  });

  it('entrada vazia produz plano vazio, nao excecao', () => {
    const resultado = reconcile(input());
    expect(resultado.matches).toHaveLength(0);
    expect(resultado.breaks).toHaveLength(0);
    expect(resultado.balance.matchedMovementCents).toBe(0n);
  });

  it('cada item aparece em no maximo um casamento', () => {
    const resultado = reconcile(diaCompleto());
    const vistos = new Set<string>();
    for (const match of resultado.matches) {
      for (const id of [match.providerItemId, match.localItemId, match.ledgerItemId]) {
        if (!id) continue;
        expect(vistos.has(id)).toBe(false);
        vistos.add(id);
      }
    }
  });
});

function chaves(matches: readonly { providerItemId?: string; localItemId?: string }[]): string[] {
  return matches.map((m) => `${m.providerItemId}->${m.localItemId}`).sort();
}

function substituirBigInt(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}
