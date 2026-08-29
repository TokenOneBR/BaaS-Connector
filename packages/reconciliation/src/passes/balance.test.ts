import { BreakSeverity, BreakType, ReconciliationSide } from '@baasconn/taxonomy';
import { describe, expect, it } from 'vitest';

import { reconcile } from '../engine.js';
import { input, item } from '../test-support.js';

const E2E = 'E1801234520260310100011111111';
const LTX = 'ltx_01JBQ8Z2K3LEDGERTXN00001';

function parCasado(amountCents: bigint, direction: 'CREDIT' | 'DEBIT' = 'CREDIT') {
  return {
    provider: [
      item({
        id: 'pit_1',
        side: ReconciliationSide.PROVIDER,
        endToEndId: E2E,
        amountCents,
        direction,
      }),
    ],
    local: [
      item({
        id: 'txn_1',
        side: ReconciliationSide.LOCAL,
        endToEndId: E2E,
        amountCents,
        direction,
        ledgerTransactionId: LTX,
      }),
    ],
    ledger: [
      item({
        id: 'len_1',
        side: ReconciliationSide.LEDGER,
        ledgerTransactionId: LTX,
        amountCents,
        direction,
      }),
    ],
  };
}

describe('passe 5 — assercao de saldo', () => {
  it('abertura mais movimento casado fechando com o provedor nao abre quebra', () => {
    const resultado = reconcile(
      input({
        ...parCasado(150_000n),
        balances: {
          providerOpeningCents: 50_000n,
          providerClosingCents: 200_000n,
          ledgerClosingCents: 200_000n,
        },
      }),
    );

    expect(resultado.breaks).toHaveLength(0);
    expect(resultado.balance.expectedClosingCents).toBe(200_000n);
    expect(resultado.balance.balanceDeltaCents).toBe(0n);
  });

  it('o debito casado entra no movimento com sinal negativo', () => {
    const resultado = reconcile(
      input({
        ...parCasado(150_000n, 'DEBIT'),
        balances: { providerOpeningCents: 200_000n, providerClosingCents: 50_000n },
      }),
    );

    expect(resultado.balance.matchedMovementCents).toBe(-150_000n);
    expect(resultado.breaks).toHaveLength(0);
  });

  it('residuo sem quebra de item vira BALANCE_MISMATCH critico', () => {
    const resultado = reconcile(
      input({
        ...parCasado(150_000n),
        balances: {
          providerOpeningCents: 50_000n,
          providerClosingCents: 199_500n,
          ledgerClosingCents: 200_000n,
        },
      }),
    );

    expect(resultado.breaks).toHaveLength(1);
    expect(resultado.breaks[0]).toMatchObject({
      type: BreakType.BALANCE_MISMATCH,
      severity: BreakSeverity.CRITICAL,
      deltaCents: -500n,
      dedupeKey: `bal:${resultado.breaks[0]!.dedupeKey.slice(4)}`,
    });
    expect(resultado.balance.balanceDeltaCents).toBe(-500n);
  });

  it('a quebra de saldo usa a data do fim da janela, nao a de hoje', () => {
    const resultado = reconcile(
      input({
        now: '2026-04-01T12:00:00.000Z',
        ...parCasado(150_000n),
        balances: { providerOpeningCents: 0n, providerClosingCents: 1n },
      }),
    );

    // A janela termina 2026-03-11T03:00Z, que em Brasilia ainda e dia 11.
    expect(resultado.breaks[0]?.effectiveDate).toBe('2026-03-11');
  });

  it('com quebra de item aberta, o residuo ja tem explicacao e nao vira segunda quebra', () => {
    const resultado = reconcile(
      input({
        provider: [item({ id: 'pit_1', side: ReconciliationSide.PROVIDER, amountCents: 150_000n })],
        balances: { providerOpeningCents: 0n, providerClosingCents: 150_000n },
      }),
    );

    expect(resultado.breaks.map((b) => b.type)).toEqual([BreakType.MISSING_ON_LOCAL]);
  });

  it('sem abertura do provedor a assercao e pulada, com o motivo dito', () => {
    const resultado = reconcile(
      input({ ...parCasado(150_000n), balances: { providerClosingCents: 200_000n } }),
    );

    expect(resultado.balance.skippedReason).toBe('no_provider_opening');
    expect(resultado.breaks).toHaveLength(0);
  });

  it('sem fechamento do provedor a assercao e pulada, com o motivo dito', () => {
    const resultado = reconcile(
      input({ ...parCasado(150_000n), balances: { providerOpeningCents: 50_000n } }),
    );

    expect(resultado.balance.skippedReason).toBe('no_provider_closing');
  });

  it('o delta de manchete e provedor menos razao', () => {
    const resultado = reconcile(
      input({
        ...parCasado(150_000n),
        balances: {
          providerOpeningCents: 50_000n,
          providerClosingCents: 200_000n,
          ledgerClosingCents: 190_000n,
        },
      }),
    );

    expect(resultado.balance.balanceDeltaCents).toBe(10_000n);
  });
});
