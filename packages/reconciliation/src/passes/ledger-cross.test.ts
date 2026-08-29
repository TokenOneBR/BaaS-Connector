import { BreakSeverity, BreakType, ReconciliationSide } from '@baasconn/taxonomy';
import { describe, expect, it } from 'vitest';

import { reconcile } from '../engine.js';
import { input, item } from '../test-support.js';

const E2E = 'E1801234520260310100011111111';
const LTX = 'ltx_01JBQ8Z2K3LEDGERTXN00001';

const provedor = () => item({ id: 'pit_1', side: ReconciliationSide.PROVIDER, endToEndId: E2E });
const local = (ledgerTransactionId?: string) =>
  item({ id: 'txn_1', side: ReconciliationSide.LOCAL, endToEndId: E2E, ledgerTransactionId });
const razao = (overrides: Partial<Parameters<typeof item>[0]> = {}) =>
  item({
    id: 'len_1',
    side: ReconciliationSide.LEDGER,
    ledgerTransactionId: LTX,
    ...overrides,
  });

describe('passe 4 — cruzamento com o razao', () => {
  it('par casado com lancamento correspondente nao abre quebra', () => {
    const resultado = reconcile(
      input({ provider: [provedor()], local: [local(LTX)], ledger: [razao()] }),
    );

    expect(resultado.breaks).toHaveLength(0);
    expect(resultado.matches[0]?.ledgerItemId).toBe('len_1');
  });

  it('par casado sem lancamento e MISSING_ON_LEDGER, sempre critico', () => {
    const resultado = reconcile(input({ provider: [provedor()], local: [local(LTX)] }));

    expect(resultado.breaks).toHaveLength(1);
    expect(resultado.breaks[0]).toMatchObject({
      type: BreakType.MISSING_ON_LEDGER,
      severity: BreakSeverity.CRITICAL,
      localItemId: 'txn_1',
    });
  });

  it('transacao sem ligacao com o razao tambem e MISSING_ON_LEDGER', () => {
    const resultado = reconcile(input({ provider: [provedor()], local: [local()] }));

    expect(resultado.breaks[0]?.type).toBe(BreakType.MISSING_ON_LEDGER);
    expect(resultado.breaks[0]?.evidence.ledger_transaction_id).toBeNull();
  });

  it('lancamento com valor diferente do registro canonico e critico sem franquia', () => {
    // Um centavo entre o provedor e nos e arredondamento do provedor. Um
    // centavo entre NOS e o NOSSO razao e defeito nosso.
    const resultado = reconcile(
      input({
        provider: [provedor()],
        local: [local(LTX)],
        ledger: [razao({ amountCents: 150_001n })],
      }),
    );

    const quebra = resultado.breaks.find((b) => b.type === BreakType.AMOUNT_MISMATCH);
    expect(quebra?.severity).toBe(BreakSeverity.CRITICAL);
    expect(quebra?.deltaCents).toBe(1n);
    expect(quebra?.ledgerItemId).toBe('len_1');
  });

  it('lancamento em data diferente abre DATE_MISMATCH com o lado do razao', () => {
    const resultado = reconcile(
      input({
        provider: [provedor()],
        local: [local(LTX)],
        ledger: [razao({ effectiveDate: '2026-03-11' })],
      }),
    );

    const quebra = resultado.breaks.find((b) => b.type === BreakType.DATE_MISMATCH);
    expect(quebra?.ledgerItemId).toBe('len_1');
    expect(quebra?.evidence.razao).toBe('2026-03-11');
  });

  it('lancamento orfao e critico e a importacao fica bloqueada por falta de item de provedor', () => {
    const resultado = reconcile(input({ ledger: [razao()] }));

    expect(resultado.breaks).toHaveLength(1);
    expect(resultado.breaks[0]).toMatchObject({
      type: BreakType.MISSING_ON_LOCAL,
      severity: BreakSeverity.CRITICAL,
      ledgerItemId: 'len_1',
    });
    expect(resultado.breaks[0]?.providerItemId).toBeUndefined();
    expect(resultado.breaks[0]?.autoResolution).toBeUndefined();
  });

  it('lancamento de transacao nao casada nao vira orfao — o problema ja foi reportado', () => {
    const resultado = reconcile(input({ local: [local(LTX)], ledger: [razao()] }));

    expect(resultado.breaks.map((b) => b.type)).toEqual([BreakType.MISSING_ON_PROVIDER]);
  });

  it('o lado do razao chega agregado por transacao e nao conta a transacao duas vezes', () => {
    // Duas pernas da MESMA transacao. Se o worker vazasse lancamento em vez de
    // transacao, este passe abriria uma quebra de orfao por perna.
    const resultado = reconcile(
      input({
        provider: [provedor()],
        local: [local(LTX)],
        ledger: [razao(), razao({ id: 'len_2' })],
      }),
    );

    expect(resultado.breaks).toHaveLength(0);
    expect(resultado.matches[0]?.ledgerItemId).toBe('len_1');
  });
});
