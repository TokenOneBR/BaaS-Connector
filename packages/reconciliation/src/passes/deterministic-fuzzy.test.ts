import { BreakType, MatchConfidence, ReconciliationSide } from '@baasconn/taxonomy';
import { describe, expect, it } from 'vitest';

import { reconcile } from '../engine.js';
import { input, item, policy } from '../test-support.js';
import type { MatchLink } from '../types.js';

function pares(matches: readonly MatchLink[]): string[] {
  return matches.map((m) => `${m.providerItemId}->${m.localItemId}`).sort();
}

describe('passe 2 — fuzzy deterministico', () => {
  it('balde 1:1 casa com confianca alta e sem revisao', () => {
    const resultado = reconcile(
      input({
        provider: [item({ id: 'pit_1', side: ReconciliationSide.PROVIDER })],
        local: [item({ id: 'txn_1', side: ReconciliationSide.LOCAL })],
      }),
    );

    expect(resultado.matches).toHaveLength(1);
    expect(resultado.matches[0]).toMatchObject({
      confidence: MatchConfidence.HIGH,
      pass: 2,
      needsReview: false,
    });
  });

  it('valor diferente cai em baldes diferentes e nao casa no passe 2', () => {
    const resultado = reconcile(
      input({
        provider: [item({ id: 'pit_1', side: ReconciliationSide.PROVIDER, amountCents: 150_000n })],
        local: [item({ id: 'txn_1', side: ReconciliationSide.LOCAL, amountCents: 149_000n })],
      }),
    );

    expect(resultado.matches.filter((m) => m.pass === 2)).toHaveLength(0);
  });

  it('sentido oposto nunca casa, mesmo com valor e data iguais', () => {
    const resultado = reconcile(
      input({
        provider: [item({ id: 'pit_1', side: ReconciliationSide.PROVIDER, direction: 'CREDIT' })],
        local: [item({ id: 'txn_1', side: ReconciliationSide.LOCAL, direction: 'DEBIT' })],
      }),
    );

    expect(resultado.matches).toHaveLength(0);
    expect(resultado.breaks.map((b) => b.type)).toContain(BreakType.MISSING_ON_LOCAL);
    expect(resultado.breaks.map((b) => b.type)).toContain(BreakType.MISSING_ON_PROVIDER);
  });

  it('n:m casa por instante mais proximo e marca para revisao', () => {
    const resultado = reconcile(
      input({
        provider: [
          item({
            id: 'pit_1',
            side: ReconciliationSide.PROVIDER,
            postedAt: '2026-03-10T09:00:00.000Z',
          }),
          item({
            id: 'pit_2',
            side: ReconciliationSide.PROVIDER,
            postedAt: '2026-03-10T17:00:00.000Z',
          }),
        ],
        local: [
          item({
            id: 'txn_1',
            side: ReconciliationSide.LOCAL,
            postedAt: '2026-03-10T17:02:00.000Z',
          }),
          item({
            id: 'txn_2',
            side: ReconciliationSide.LOCAL,
            postedAt: '2026-03-10T09:02:00.000Z',
          }),
        ],
      }),
    );

    expect(pares(resultado.matches)).toEqual(['pit_1->txn_2', 'pit_2->txn_1']);
    expect(resultado.matches.every((m) => m.needsReview)).toBe(true);
  });

  it('o guloso desempata por id, e a ordem de entrada nao muda o resultado', () => {
    // Dois candidatos EXATAMENTE equidistantes. Sem o desempate lexicografico,
    // quem casa depende da ordem em que o Postgres devolveu as linhas — e a
    // mesma janela conciliada duas vezes produziria quebras diferentes.
    const construir = (ordem: 'direta' | 'invertida') => {
      const locais = [
        item({ id: 'txn_a', side: ReconciliationSide.LOCAL, postedAt: '2026-03-10T09:00:00.000Z' }),
        item({ id: 'txn_b', side: ReconciliationSide.LOCAL, postedAt: '2026-03-10T11:00:00.000Z' }),
      ];
      return input({
        provider: [
          item({
            id: 'pit_1',
            side: ReconciliationSide.PROVIDER,
            postedAt: '2026-03-10T10:00:00.000Z',
          }),
        ],
        local: ordem === 'direta' ? locais : [...locais].reverse(),
      });
    };

    const a = reconcile(construir('direta'));
    const b = reconcile(construir('invertida'));
    expect(pares(a.matches)).toEqual(pares(b.matches));
    expect(pares(a.matches)).toEqual(['pit_1->txn_a']);
  });

  it('sobra com contraparte identica a um item casado vira duplicata', () => {
    const resultado = reconcile(
      input({
        provider: [
          item({ id: 'pit_1', side: ReconciliationSide.PROVIDER, counterpartyTaxIdIndex: 'idx_x' }),
        ],
        local: [
          item({
            id: 'txn_1',
            side: ReconciliationSide.LOCAL,
            counterpartyTaxIdIndex: 'idx_x',
            postedAt: '2026-03-10T13:00:00.000Z',
          }),
          item({
            id: 'txn_2',
            side: ReconciliationSide.LOCAL,
            counterpartyTaxIdIndex: 'idx_x',
            postedAt: '2026-03-10T13:00:30.000Z',
          }),
        ],
      }),
    );

    const dup = resultado.breaks.find((b) => b.type === BreakType.DUPLICATE_LOCAL);
    expect(dup?.localItemId).toBe('txn_2');
    expect(resultado.breaks.some((b) => b.type === BreakType.MISSING_ON_PROVIDER)).toBe(false);
  });

  it('dois pagamentos genuinos iguais dos dois lados nao viram duplicata', () => {
    const resultado = reconcile(
      input({
        provider: [
          item({ id: 'pit_1', side: ReconciliationSide.PROVIDER, counterpartyTaxIdIndex: 'idx_x' }),
          item({ id: 'pit_2', side: ReconciliationSide.PROVIDER, counterpartyTaxIdIndex: 'idx_x' }),
        ],
        local: [
          item({ id: 'txn_1', side: ReconciliationSide.LOCAL, counterpartyTaxIdIndex: 'idx_x' }),
          item({ id: 'txn_2', side: ReconciliationSide.LOCAL, counterpartyTaxIdIndex: 'idx_x' }),
        ],
      }),
    );

    expect(resultado.matches).toHaveLength(2);
    expect(resultado.breaks.filter((b) => b.type === BreakType.DUPLICATE_LOCAL)).toHaveLength(0);
  });

  it('sobra sem contraparte conhecida nao e chutada como duplicata', () => {
    const resultado = reconcile(
      input({
        provider: [item({ id: 'pit_1', side: ReconciliationSide.PROVIDER })],
        local: [
          item({ id: 'txn_1', side: ReconciliationSide.LOCAL }),
          item({ id: 'txn_2', side: ReconciliationSide.LOCAL }),
        ],
      }),
    );

    expect(resultado.breaks.filter((b) => b.type === BreakType.DUPLICATE_LOCAL)).toHaveLength(0);
    expect(resultado.breaks.filter((b) => b.type === BreakType.MISSING_ON_PROVIDER)).toHaveLength(
      1,
    );
  });

  it('balde maior que maxGreedyPairs nao e adivinhado', () => {
    const resultado = reconcile(
      input({
        policy: policy({
          maxGreedyPairs: 1,
          dateToleranceBusinessDays: 0,
          amountToleranceCents: 0n,
        }),
        provider: [
          item({ id: 'pit_1', side: ReconciliationSide.PROVIDER }),
          item({ id: 'pit_2', side: ReconciliationSide.PROVIDER }),
        ],
        local: [
          item({ id: 'txn_1', side: ReconciliationSide.LOCAL }),
          item({ id: 'txn_2', side: ReconciliationSide.LOCAL }),
        ],
      }),
    );

    // Cai para o passe 3, que com dois candidatos na janela recusa escolher.
    expect(resultado.matches.filter((m) => m.pass === 2)).toHaveLength(0);
  });
});
