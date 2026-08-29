import {
  BreakSeverity,
  BreakType,
  MatchConfidence,
  ReconciliationSide,
  ResolutionAction,
  TransactionStatus,
} from '@baasconn/taxonomy';
import { describe, expect, it } from 'vitest';

import { reconcile } from '../engine.js';
import { input, item, policy } from '../test-support.js';
import type { BreakDraft } from '../types.js';

const E2E = 'E1801234520260310100011111111';

function breakOf(breaks: readonly BreakDraft[], type: BreakType): BreakDraft | undefined {
  return breaks.find((b) => b.type === type);
}

describe('passe 1 — chave forte', () => {
  it('casa por E2EID com confianca exata', () => {
    const resultado = reconcile(
      input({
        provider: [item({ id: 'pit_1', side: ReconciliationSide.PROVIDER, endToEndId: E2E })],
        local: [item({ id: 'txn_1', side: ReconciliationSide.LOCAL, endToEndId: E2E })],
      }),
    );

    expect(resultado.matches).toHaveLength(1);
    expect(resultado.matches[0]).toMatchObject({
      providerItemId: 'pit_1',
      localItemId: 'txn_1',
      confidence: MatchConfidence.EXACT,
      pass: 1,
    });
  });

  it('nao cruza E2EID de um item com providerTransactionId de outro', () => {
    // O namespace e o que impede isso. Sem ele, o casamento sairia com
    // confianca EXACT — o pior desfecho possivel, porque ninguem revisa o que
    // o sistema declarou exato.
    const resultado = reconcile(
      input({
        provider: [
          item({
            id: 'pit_1',
            side: ReconciliationSide.PROVIDER,
            providerTransactionId: E2E,
            amountCents: 111n,
          }),
        ],
        local: [
          item({ id: 'txn_1', side: ReconciliationSide.LOCAL, endToEndId: E2E, amountCents: 222n }),
        ],
      }),
    );

    expect(resultado.matches.filter((m) => m.pass === 1)).toHaveLength(0);
  });

  it('divergencia de valor no par casado nao desfaz o casamento', () => {
    const resultado = reconcile(
      input({
        provider: [
          item({
            id: 'pit_1',
            side: ReconciliationSide.PROVIDER,
            endToEndId: E2E,
            amountCents: 150_500n,
          }),
        ],
        local: [
          item({
            id: 'txn_1',
            side: ReconciliationSide.LOCAL,
            endToEndId: E2E,
            amountCents: 150_000n,
          }),
        ],
      }),
    );

    expect(resultado.matches).toHaveLength(1);
    const quebra = breakOf(resultado.breaks, BreakType.AMOUNT_MISMATCH);
    expect(quebra?.severity).toBe(BreakSeverity.CRITICAL);
    expect(quebra?.deltaCents).toBe(500n);
  });

  it('provedor a frente do nosso registro propoe aplicar o status dele', () => {
    const resultado = reconcile(
      input({
        provider: [
          item({
            id: 'pit_1',
            side: ReconciliationSide.PROVIDER,
            endToEndId: E2E,
            status: TransactionStatus.SETTLED,
          }),
        ],
        local: [
          item({
            id: 'txn_1',
            side: ReconciliationSide.LOCAL,
            endToEndId: E2E,
            status: TransactionStatus.PROCESSING,
          }),
        ],
      }),
    );

    const quebra = breakOf(resultado.breaks, BreakType.STATUS_MISMATCH);
    expect(quebra?.autoResolution).toEqual({
      action: ResolutionAction.MARK_PROVIDER_AUTHORITATIVE,
      localItemId: 'txn_1',
      fromStatus: TransactionStatus.PROCESSING,
      toStatus: TransactionStatus.SETTLED,
    });
  });

  it('nosso SETTLED contra FAILED do provedor e critico e nunca auto-resolve', () => {
    const resultado = reconcile(
      input({
        provider: [
          item({
            id: 'pit_1',
            side: ReconciliationSide.PROVIDER,
            endToEndId: E2E,
            status: TransactionStatus.FAILED,
          }),
        ],
        local: [
          item({
            id: 'txn_1',
            side: ReconciliationSide.LOCAL,
            endToEndId: E2E,
            status: TransactionStatus.SETTLED,
          }),
        ],
      }),
    );

    const quebra = breakOf(resultado.breaks, BreakType.STATUS_MISMATCH);
    expect(quebra?.severity).toBe(BreakSeverity.CRITICAL);
    expect(quebra?.autoResolution).toBeUndefined();
  });

  it('deriva de um dia util propoe ignorar a diferenca temporal', () => {
    const resultado = reconcile(
      input({
        provider: [
          item({
            id: 'pit_1',
            side: ReconciliationSide.PROVIDER,
            endToEndId: E2E,
            effectiveDate: '2026-03-11',
          }),
        ],
        local: [
          item({
            id: 'txn_1',
            side: ReconciliationSide.LOCAL,
            endToEndId: E2E,
            effectiveDate: '2026-03-10',
          }),
        ],
      }),
    );

    const quebra = breakOf(resultado.breaks, BreakType.DATE_MISMATCH);
    expect(quebra?.severity).toBe(BreakSeverity.LOW);
    expect(quebra?.autoResolution?.action).toBe(ResolutionAction.IGNORE_TIMING_DIFFERENCE);
  });

  it('deriva alem da tolerancia de auto-resolucao nao propoe nada', () => {
    const resultado = reconcile(
      input({
        policy: policy({ dateToleranceBusinessDays: 0 }),
        provider: [
          item({
            id: 'pit_1',
            side: ReconciliationSide.PROVIDER,
            endToEndId: E2E,
            effectiveDate: '2026-03-16',
          }),
        ],
        local: [
          item({
            id: 'txn_1',
            side: ReconciliationSide.LOCAL,
            endToEndId: E2E,
            effectiveDate: '2026-03-10',
          }),
        ],
      }),
    );

    const quebra = breakOf(resultado.breaks, BreakType.DATE_MISMATCH);
    expect(quebra?.severity).toBe(BreakSeverity.MEDIUM);
    expect(quebra?.autoResolution).toBeUndefined();
  });

  it('duas linhas nossas com o mesmo E2EID viram DUPLICATE_LOCAL', () => {
    const resultado = reconcile(
      input({
        provider: [item({ id: 'pit_1', side: ReconciliationSide.PROVIDER, endToEndId: E2E })],
        local: [
          item({
            id: 'txn_1',
            side: ReconciliationSide.LOCAL,
            endToEndId: E2E,
            postedAt: '2026-03-10T10:00:00.000Z',
          }),
          item({
            id: 'txn_2',
            side: ReconciliationSide.LOCAL,
            endToEndId: E2E,
            postedAt: '2026-03-10T10:01:00.000Z',
          }),
        ],
      }),
    );

    const quebra = breakOf(resultado.breaks, BreakType.DUPLICATE_LOCAL);
    expect(quebra?.localItemId).toBe('txn_2');
    expect(quebra?.evidence.duplicado_de).toBe('txn_1');
    expect(resultado.matches[0]?.localItemId).toBe('txn_1');
  });

  it('duas linhas do provedor com o mesmo E2EID viram DUPLICATE_PROVIDER', () => {
    const resultado = reconcile(
      input({
        provider: [
          item({
            id: 'pit_1',
            side: ReconciliationSide.PROVIDER,
            endToEndId: E2E,
            postedAt: '2026-03-10T10:00:00.000Z',
          }),
          item({
            id: 'pit_2',
            side: ReconciliationSide.PROVIDER,
            endToEndId: E2E,
            postedAt: '2026-03-10T10:02:00.000Z',
          }),
        ],
        local: [item({ id: 'txn_1', side: ReconciliationSide.LOCAL, endToEndId: E2E })],
      }),
    );

    expect(breakOf(resultado.breaks, BreakType.DUPLICATE_PROVIDER)?.providerItemId).toBe('pit_2');
  });

  it('casa por providerTransactionId quando nao ha E2EID', () => {
    const resultado = reconcile(
      input({
        provider: [
          item({ id: 'pit_1', side: ReconciliationSide.PROVIDER, providerTransactionId: 'MB-9' }),
        ],
        local: [
          item({ id: 'txn_1', side: ReconciliationSide.LOCAL, providerTransactionId: 'MB-9' }),
        ],
      }),
    );

    expect(resultado.matches[0]?.pass).toBe(1);
    expect(resultado.matches[0]?.confidence).toBe(MatchConfidence.EXACT);
  });
});
