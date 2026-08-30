import type { LedgerMovement, TransactionRecord } from '@baasconn/api/domain';
import { LedgerTransactionType } from '@baasconn/ledger';
import type { StatementEntry } from '@baasconn/provider-spi';
import {
  Environment,
  StatementEntryType,
  TransactionDirection,
  TransactionStatus,
  TransactionType,
} from '@baasconn/taxonomy';
import { describe, expect, it } from 'vitest';

import {
  RECONCILIATION_STATUSES,
  fromLedgerMovement,
  fromStatementEntry,
  fromTransaction,
  mirrorsProviderMovement,
} from './normalizers.js';

const CONTA = 'acc_01JBQ8Z2K3TESTACCOUNT00001';

describe('espelhamento de movimento do provedor', () => {
  it('inclui os tipos que o provedor tambem tem', () => {
    for (const tipo of [
      LedgerTransactionType.PIX_IN_RECEIVE,
      LedgerTransactionType.PIX_OUT_SETTLE,
      LedgerTransactionType.PIX_REFUND_IN,
      LedgerTransactionType.PIX_REFUND_OUT,
      LedgerTransactionType.FEE_CHARGE,
    ]) {
      expect(mirrorsProviderMovement(tipo)).toBe(true);
    }
  });

  it('exclui bloqueio e desbloqueio', () => {
    // Incluí-los faria todo bloqueio judicial virar um lancamento orfao
    // CRITICAL falso: o provedor nunca tera contraparte para eles.
    expect(mirrorsProviderMovement(LedgerTransactionType.BLOCK_FUNDS)).toBe(false);
    expect(mirrorsProviderMovement(LedgerTransactionType.UNBLOCK_FUNDS)).toBe(false);
  });

  it('exclui a autorizacao pendente do PIX out', () => {
    // A fase pendente nao e movimento; quem aparece e o SETTLE que a resolve.
    expect(mirrorsProviderMovement(LedgerTransactionType.PIX_OUT_AUTHORIZE)).toBe(false);
    expect(mirrorsProviderMovement(LedgerTransactionType.PIX_OUT_VOID)).toBe(false);
  });

  it('exclui o proprio ajuste de conciliacao', () => {
    // Incluí-lo faria o ajuste de ontem virar a quebra de hoje, para sempre.
    expect(mirrorsProviderMovement(LedgerTransactionType.RECONCILIATION_ADJUSTMENT)).toBe(false);
  });
});

describe('status que a conciliacao examina', () => {
  it('inclui UNKNOWN, que o extrato do cliente nao mostra', () => {
    // Um PIX out em UNKNOWN ausente do extrato do provedor e exatamente o
    // sinal que a escada do desfecho desconhecido persegue.
    expect(RECONCILIATION_STATUSES).toContain(TransactionStatus.UNKNOWN);
    expect(RECONCILIATION_STATUSES).toContain(TransactionStatus.PENDING);
    expect(RECONCILIATION_STATUSES).toContain(TransactionStatus.PROCESSING);
  });

  it('exclui o que nunca moveu dinheiro', () => {
    expect(RECONCILIATION_STATUSES).not.toContain(TransactionStatus.CREATED);
    expect(RECONCILIATION_STATUSES).not.toContain(TransactionStatus.FAILED);
    expect(RECONCILIATION_STATUSES).not.toContain(TransactionStatus.CANCELLED);
  });
});

describe('normalizacao', () => {
  const entrada: StatementEntry = {
    providerEntryId: 'MB-1',
    postedAt: '2026-03-10T13:00:00.000Z',
    effectiveDate: '2026-03-10',
    direction: 'credit',
    amount: { amount: '150000', currency: 'BRL', scale: 2 },
    type: StatementEntryType.PIX_IN,
    endToEndId: 'E1801234520260310100011111111',
  };

  it('a entrada do provedor vira item com chave forte namespaceada', () => {
    const item = fromStatementEntry(entrada, CONTA);
    expect(item.id).toMatch(/^rci_/);
    expect(item.matchKeyStrong).toBe('e2e:E1801234520260310100011111111');
    expect(item.amountCents).toBe(150_000n);
    expect(item.direction).toBe('CREDIT');
  });

  it('o item cunha o id ANTES do motor, para a quebra apontar para a linha', () => {
    // A quebra grava `providerItemId`; se o id nascesse depois, apontaria
    // para nada e a tela lado a lado do console ficaria vazia.
    const a = fromStatementEntry(entrada, CONTA);
    const b = fromStatementEntry(entrada, CONTA);
    expect(a.id).not.toBe(b.id);
    expect(a.matchKeyFuzzy).toBe(b.matchKeyFuzzy);
  });

  it('a transacao usa a data de liquidacao como instante, nao a de criacao', () => {
    const transacao = {
      id: 'txn_1',
      environment: Environment.HOMOLOGACAO,
      accountId: CONTA,
      type: TransactionType.PIX_OUT,
      direction: TransactionDirection.DEBIT,
      status: TransactionStatus.SETTLED,
      amountCents: 25_000n,
      feeCents: 0n,
      netAmountCents: 25_000n,
      refundedAmountCents: 0n,
      currency: 'BRL',
      provider: 'MOCK_BANK',
      providerConnectionId: 'con_1',
      effectiveDate: '2026-03-10',
      requestedAt: new Date('2026-03-09T23:59:00.000Z'),
      settledAt: new Date('2026-03-10T00:01:00.000Z'),
      metadata: {},
      createdAt: new Date('2026-03-09T23:59:00.000Z'),
      updatedAt: new Date('2026-03-10T00:01:00.000Z'),
    } as TransactionRecord;

    const item = fromTransaction(transacao);
    expect(item.postedAt.toISOString()).toBe('2026-03-10T00:01:00.000Z');
    expect(item.direction).toBe('DEBIT');
    expect(item.status).toBe(TransactionStatus.SETTLED);
  });

  it('o movimento do razao carrega o id da transacao, nao o do lancamento', () => {
    // O passe 4 casa por transacao; um lancamento e meia transacao.
    const movimento: LedgerMovement = {
      entryId: 'len_1',
      transactionId: 'ltx_1',
      type: LedgerTransactionType.PIX_IN_RECEIVE,
      direction: 'CREDIT',
      amountCents: 150_000n,
      effectiveAt: new Date('2026-03-10T13:00:00.000Z'),
    };

    const item = fromLedgerMovement(movimento, CONTA);
    expect(item.ledgerTransactionId).toBe('ltx_1');
    expect(item.externalId).toBe('len_1');
    expect(item.matchKeyStrong).toBeUndefined();
  });

  it('os tres lados de um mesmo movimento caem no mesmo balde fuzzy', () => {
    // E o que faz o passe 2 e o passe 4 se encontrarem.
    const doProvedor = fromStatementEntry(entrada, CONTA);
    const doRazao = fromLedgerMovement(
      {
        entryId: 'len_1',
        transactionId: 'ltx_1',
        type: LedgerTransactionType.PIX_IN_RECEIVE,
        direction: 'CREDIT',
        amountCents: 150_000n,
        effectiveAt: new Date('2026-03-10T13:00:00.000Z'),
      },
      CONTA,
    );
    expect(doProvedor.matchKeyFuzzy).toBe(doRazao.matchKeyFuzzy);
  });
});
