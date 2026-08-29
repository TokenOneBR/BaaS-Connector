import {
  BreakSeverity,
  BreakType,
  MatchConfidence,
  ReconciliationSide,
  ResolutionAction,
} from '@baasconn/taxonomy';
import { describe, expect, it } from 'vitest';

import { reconcile } from '../engine.js';
import { input, item, policy } from '../test-support.js';

describe('passe 3 — fuzzy com janela', () => {
  it('candidato unico dentro da tolerancia casa com confianca baixa e revisao', () => {
    const resultado = reconcile(
      input({
        provider: [item({ id: 'pit_1', side: ReconciliationSide.PROVIDER, amountCents: 150_010n })],
        local: [
          item({
            id: 'txn_1',
            side: ReconciliationSide.LOCAL,
            amountCents: 150_000n,
            effectiveDate: '2026-03-11',
          }),
        ],
        policy: policy({ amountToleranceCents: 20n }),
      }),
    );

    expect(resultado.matches[0]).toMatchObject({
      confidence: MatchConfidence.LOW,
      pass: 3,
      needsReview: true,
    });
  });

  it('a fronteira da tolerancia proporcional cai exatamente no centavo calculado', () => {
    // 1 ponto-base de 10^15 e exatamente 10^11. Um centavo abaixo casa, um
    // centavo acima nao — a fronteira nao pode ser aproximada.
    // (A prova de que a aritmetica e bigint puro vive em `types.test.ts`.)
    const grande = 1_000_000_000_000_000n;
    const tolerancia = 100_000_000_000n;

    const casar = (delta: bigint) =>
      reconcile(
        input({
          provider: [
            item({
              id: 'pit_1',
              side: ReconciliationSide.PROVIDER,
              amountCents: grande + delta,
            }),
          ],
          local: [item({ id: 'txn_1', side: ReconciliationSide.LOCAL, amountCents: grande })],
        }),
      ).matches;

    expect(casar(tolerancia)).toHaveLength(1);
    expect(casar(tolerancia + 1n)).toHaveLength(0);
  });

  it('mais de um candidato na janela nao casa e o item nao e importado', () => {
    const resultado = reconcile(
      input({
        provider: [item({ id: 'pit_1', side: ReconciliationSide.PROVIDER, amountCents: 150_000n })],
        local: [
          item({
            id: 'txn_1',
            side: ReconciliationSide.LOCAL,
            amountCents: 149_999n,
            effectiveDate: '2026-03-11',
          }),
          item({
            id: 'txn_2',
            side: ReconciliationSide.LOCAL,
            amountCents: 150_001n,
            effectiveDate: '2026-03-11',
          }),
        ],
      }),
    );

    const quebra = resultado.breaks.find((b) => b.type === BreakType.MISSING_ON_LOCAL);
    expect(quebra?.evidence.ambiguo).toBe(true);
    expect(quebra?.autoResolution).toBeUndefined();
  });

  it('credito orfao do provedor propoe importacao — a recuperacao de webhook perdido', () => {
    const resultado = reconcile(
      input({
        provider: [
          item({
            id: 'pit_1',
            side: ReconciliationSide.PROVIDER,
            direction: 'CREDIT',
            type: 'PIX_IN',
          }),
        ],
      }),
    );

    const quebra = resultado.breaks[0];
    expect(quebra?.type).toBe(BreakType.MISSING_ON_LOCAL);
    expect(quebra?.severity).toBe(BreakSeverity.HIGH);
    expect(quebra?.autoResolution).toEqual({
      action: ResolutionAction.IMPORT_FROM_PROVIDER,
      providerItemId: 'pit_1',
    });
  });

  it('debito orfao do provedor e critico e nunca importa', () => {
    const resultado = reconcile(
      input({
        provider: [
          item({
            id: 'pit_1',
            side: ReconciliationSide.PROVIDER,
            direction: 'DEBIT',
            type: 'PIX_OUT',
          }),
        ],
      }),
    );

    expect(resultado.breaks[0]?.severity).toBe(BreakSeverity.CRITICAL);
    expect(resultado.breaks[0]?.autoResolution).toBeUndefined();
  });

  it('tarifa e devolucao orfas tem tipo proprio, nao MISSING_ON_LOCAL', () => {
    const resultado = reconcile(
      input({
        provider: [
          item({ id: 'pit_1', side: ReconciliationSide.PROVIDER, type: 'FEE', direction: 'DEBIT' }),
          item({
            id: 'pit_2',
            side: ReconciliationSide.PROVIDER,
            type: 'REFUND',
            amountCents: 90_000n,
          }),
        ],
      }),
    );

    const tipos = resultado.breaks.map((b) => b.type);
    expect(tipos).toContain(BreakType.UNMATCHED_FEE);
    expect(tipos).toContain(BreakType.ORPHAN_REFUND);
    expect(resultado.breaks.every((b) => b.autoResolution === undefined)).toBe(true);
  });

  it('debito nosso sem par no provedor e critico e nunca auto-resolve', () => {
    const resultado = reconcile(
      input({
        local: [
          item({
            id: 'txn_1',
            side: ReconciliationSide.LOCAL,
            direction: 'DEBIT',
            type: 'PIX_OUT',
          }),
        ],
      }),
    );

    const quebra = resultado.breaks[0];
    expect(quebra?.type).toBe(BreakType.MISSING_ON_PROVIDER);
    expect(quebra?.severity).toBe(BreakSeverity.CRITICAL);
    expect(quebra?.autoResolution).toBeUndefined();
  });

  it('movimento recente e pendencia de liquidacao, nao quebra', () => {
    // Sem esta supressao, a intraday roda a cada 30 min e abre quebra para
    // todo PIX dos ultimos minutos: 48 quebras falsas por dia, por conta.
    const resultado = reconcile(
      input({
        now: '2026-03-10T13:30:00.000Z',
        local: [
          item({
            id: 'txn_1',
            side: ReconciliationSide.LOCAL,
            postedAt: '2026-03-10T13:00:00.000Z',
          }),
        ],
      }),
    );

    expect(resultado.breaks).toHaveLength(0);
    expect(resultado.pendingSettlement).toEqual(['txn_1']);
  });

  it('a graca e por item: um movimento antigo em janela recente ainda quebra', () => {
    const resultado = reconcile(
      input({
        now: '2026-03-10T13:30:00.000Z',
        local: [
          item({
            id: 'txn_antigo',
            side: ReconciliationSide.LOCAL,
            postedAt: '2026-03-09T13:00:00.000Z',
            effectiveDate: '2026-03-09',
          }),
          item({
            id: 'txn_novo',
            side: ReconciliationSide.LOCAL,
            postedAt: '2026-03-10T13:00:00.000Z',
          }),
        ],
      }),
    );

    expect(resultado.pendingSettlement).toEqual(['txn_novo']);
    expect(resultado.breaks.map((b) => b.localItemId)).toEqual(['txn_antigo']);
  });

  it('conta diferente nunca casa, mesmo com tudo o mais igual', () => {
    const resultado = reconcile(
      input({
        provider: [
          item({ id: 'pit_1', side: ReconciliationSide.PROVIDER, accountId: 'acc_outra' }),
        ],
        local: [item({ id: 'txn_1', side: ReconciliationSide.LOCAL })],
      }),
    );

    expect(resultado.matches).toHaveLength(0);
  });
});
