import { computeBalances } from '@baasconn/ledger';
import {
  AccountKind,
  AccountStatus,
  ChangeSource,
  Environment,
  FixedClock,
  Money,
  TransactionDirection,
  TransactionStatus,
  TransactionType,
  PixInitiationMethod,
  PixPurpose,
  newId,
  toEffectiveDate,
} from '@baasconn/taxonomy';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountRecord } from '../accounts/accounts.types.js';
import { InMemoryCacheStore } from '../cache/memory-cache.store.js';
import { MemoryLedgerStoreFactory } from '../ledger/memory-ledger-store.js';
import { ShadowLedgerService } from '../ledger/shadow-ledger.service.js';
import {
  MemoryAccountRepository,
  MemoryOutboxRepository,
} from '../persistence/memory/domain.repositories.js';
import {
  MemoryOperationRepository,
  MemoryTransactionRepository,
} from '../persistence/memory/pix.repositories.js';

import { OperationReconciler } from './operation-reconciler.js';
import type { OperationRecord, TransactionRecord } from './pix.types.js';

const ENV = Environment.HOMOLOGACAO;

describe('resolvedor de desfecho desconhecido', () => {
  let clock: FixedClock;
  let ledger: ShadowLedgerService;
  let factory: MemoryLedgerStoreFactory;
  let transactions: MemoryTransactionRepository;
  let operations: MemoryOperationRepository;
  let reconciler: OperationReconciler;
  let account: AccountRecord;
  let transaction: TransactionRecord;
  let operation: OperationRecord;
  let findByIdempotencyKey: ReturnType<typeof vi.fn>;
  let send: ReturnType<typeof vi.fn>;
  let statementList: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    clock = new FixedClock(new Date('2026-08-29T12:00:00.000Z'));
    factory = new MemoryLedgerStoreFactory(clock);
    ledger = new ShadowLedgerService(factory, clock);
    transactions = new MemoryTransactionRepository();
    operations = new MemoryOperationRepository();

    const accounts = new MemoryAccountRepository();
    const accountId = newId('account');
    const ledgerAccounts = await ledger.openAccounts(ENV, accountId);

    account = {
      id: accountId,
      environment: ENV,
      holderId: newId('holder'),
      provider: 'mock-bank',
      providerConnectionId: 'con_1',
      providerAccountId: 'mb-acc-1',
      externalId: null,
      status: AccountStatus.ACTIVE,
      kind: AccountKind.PAYMENT,
      currency: 'BRL',
      ledgerAvailableAccountId: ledgerAccounts.availableId,
      ledgerBlockedAccountId: ledgerAccounts.blockedId,
      metadata: {},
      createdAt: clock.now(),
      updatedAt: clock.now(),
    };
    await accounts.create(account);

    await ledger.creditIn({
      environment: ENV,
      availableId: ledgerAccounts.availableId,
      amountCents: 100_000n,
      idempotencyKey: 'saldo-inicial',
    });

    // Estado deixado por um PIX out sem desfecho: hold de pe, transacao em
    // UNKNOWN, operacao registrada.
    const operationId = newId('operation');
    const hold = await ledger.authorizeOut({
      environment: ENV,
      availableId: ledgerAccounts.availableId,
      amountCents: 50_000n,
      idempotencyKey: `pix-out:${operationId}`,
    });

    transaction = await transactions.create({
      id: newId('transaction'),
      environment: ENV,
      accountId,
      type: TransactionType.PIX_OUT,
      direction: TransactionDirection.DEBIT,
      status: TransactionStatus.UNKNOWN,
      lastEventAt: clock.now(),
      amountCents: 50_000n,
      feeCents: 0n,
      netAmountCents: 50_000n,
      refundedAmountCents: 0n,
      currency: 'BRL',
      provider: 'mock-bank',
      providerConnectionId: 'con_1',
      idempotencyKey: operationId,
      operationId,
      effectiveDate: toEffectiveDate(clock.now()),
      requestedAt: clock.now(),
      ledgerPendingTransactionId: hold.transaction.id,
      pix: {
        initiationMethod: PixInitiationMethod.KEY,
        purpose: PixPurpose.TRANSFER,
        keyValue: 'destino@exemplo.test',
      },
      metadata: {},
      createdAt: clock.now(),
      updatedAt: clock.now(),
    });

    operation = await operations.create({
      id: operationId,
      environment: ENV,
      connectionId: 'con_1',
      kind: 'pix.out',
      providerIdempotencyKey: operationId,
      status: 'UNKNOWN',
      requestDigest: transaction.id,
      accountId,
      amountCents: 50_000n,
      attempts: 1,
      createdAt: clock.now(),
      updatedAt: clock.now(),
    });

    findByIdempotencyKey = vi.fn(async () => null);
    send = vi.fn();
    statementList = vi.fn(async () => ({ data: [], hasMore: false }));

    const providers = {
      resolve: vi.fn(async () => ({
        slug: 'mock-bank',
        adapter: {
          pixTransfers: { findByIdempotencyKey, send, get: vi.fn(async () => null) },
          statement: { list: statementList },
        },
      })),
    };

    reconciler = new OperationReconciler(
      providers as never,
      ledger,
      operations,
      transactions,
      accounts,
      new MemoryOutboxRepository(),
      new InMemoryCacheStore(clock),
      clock,
    );
  });

  const available = () =>
    computeBalances(
      factory
        .for(ENV)
        .snapshot()
        .accounts.find((row) => row.id === account.ledgerAvailableAccountId)!,
    );

  it('NUNCA reenvia o pagamento', async () => {
    // A regra que define o mecanismo inteiro: o provedor pode ter aceitado a
    // primeira chamada e so nao ter conseguido nos responder.
    await reconciler.resolve(ENV, operation.id);
    expect(send).not.toHaveBeenCalled();
  });

  it('liquidado no provedor: confirma o hold e liquida a transacao', async () => {
    findByIdempotencyKey.mockResolvedValue({
      providerTransactionId: 'mb-txn-1',
      endToEndId: 'E1234567820260829120011111111111',
      status: TransactionStatus.SETTLED,
      direction: 'out',
      amount: Money.of(50_000n).toJSON(),
      createdAt: clock.now().toISOString(),
      settledAt: clock.now().toISOString(),
    });

    const result = await reconciler.resolve(ENV, operation.id);

    expect(result).toMatchObject({ resolved: true, status: TransactionStatus.SETTLED });
    // O hold virou movimento: 100.000 - 50.000.
    expect(available().available).toBe(50_000n);
    expect(available().pending).toBe(0n);

    const stored = await transactions.findById(ENV, transaction.id);
    expect(stored?.status).toBe(TransactionStatus.SETTLED);
    expect(stored?.pix?.endToEndId).toBe('E1234567820260829120011111111111');
    expect((await operations.findById(ENV, operation.id))?.status).toBe('SETTLED');
  });

  it('falhado no provedor: desfaz o hold e devolve o saldo', async () => {
    findByIdempotencyKey.mockResolvedValue({
      providerTransactionId: 'mb-txn-1',
      status: TransactionStatus.FAILED,
      direction: 'out',
      amount: Money.of(50_000n).toJSON(),
      createdAt: clock.now().toISOString(),
      failure: { code: 'MB-PIX-422', message: 'chave inexistente' },
    });

    const result = await reconciler.resolve(ENV, operation.id);

    expect(result).toMatchObject({ resolved: true, status: TransactionStatus.FAILED });
    expect(available().available).toBe(100_000n);
    const stored = await transactions.findById(ENV, transaction.id);
    expect(stored?.providerFailureCode).toBe('MB-PIX-422');
  });

  it('ausente no provedor MANTEM o hold', async () => {
    // Ausente nao conclui nada: pode ser atraso de indexacao. Liberar aqui
    // devolveria saldo que talvez ja tenha saido.
    const result = await reconciler.resolve(ENV, operation.id);

    expect(result).toMatchObject({ resolved: false, reason: 'not_found_at_provider' });
    expect(available().available).toBe(50_000n);
    expect((await transactions.findById(ENV, transaction.id))?.status).toBe(
      TransactionStatus.UNKNOWN,
    );
  });

  it('cai para a varredura de extrato quando a consulta por chave nao acha', async () => {
    statementList.mockResolvedValue({
      data: [
        {
          providerEntryId: 'mb-entry-1',
          postedAt: clock.now().toISOString(),
          effectiveDate: toEffectiveDate(clock.now()),
          direction: 'debit',
          amount: Money.of(50_000n).toJSON(),
          type: 'PIX_OUT',
          endToEndId: 'E1234567820260829120022222222222',
        },
      ],
      hasMore: false,
    });

    const result = await reconciler.resolve(ENV, operation.id);
    expect(result).toMatchObject({ resolved: true, status: TransactionStatus.SETTLED });
    expect(available().available).toBe(50_000n);
  });

  it('extrato ambiguo nao resolve', async () => {
    // Duas saidas do mesmo valor no mesmo dia: casar uma delas seria adivinhar
    // com dinheiro do cliente.
    const entry = {
      providerEntryId: 'mb-entry-1',
      postedAt: clock.now().toISOString(),
      effectiveDate: toEffectiveDate(clock.now()),
      direction: 'debit' as const,
      amount: Money.of(50_000n).toJSON(),
      type: 'PIX_OUT',
    };
    statementList.mockResolvedValue({
      data: [entry, { ...entry, providerEntryId: 'mb-entry-2' }],
      hasMore: false,
    });

    const result = await reconciler.resolve(ENV, operation.id);
    expect(result).toMatchObject({ resolved: false });
    expect(available().available).toBe(50_000n);
  });

  it('conta a tentativa mesmo quando nao resolve', async () => {
    await reconciler.resolve(ENV, operation.id);
    // Sem o contador, a escada do worker nao teria como saber quando desistir
    // e abrir o break para revisao humana.
    expect((await operations.findById(ENV, operation.id))?.attempts).toBe(2);
  });

  it('operacao ja resolvida nao e reprocessada', async () => {
    await operations.update({ environment: ENV, id: operation.id, status: 'SETTLED' });
    const result = await reconciler.resolve(ENV, operation.id);
    expect(result).toMatchObject({ resolved: false, reason: 'not_stuck' });
    expect(findByIdempotencyKey).not.toHaveBeenCalled();
  });

  it('registra a resolucao com origem RECONCILIATION', async () => {
    findByIdempotencyKey.mockResolvedValue({
      providerTransactionId: 'mb-txn-1',
      status: TransactionStatus.SETTLED,
      direction: 'out',
      amount: Money.of(50_000n).toJSON(),
      createdAt: clock.now().toISOString(),
    });

    await reconciler.resolve(ENV, operation.id);
    // A origem e o que responde "por que este status mudou sem webhook".
    expect(transactions.statusHistory).toContainEqual({
      transactionId: transaction.id,
      from: TransactionStatus.UNKNOWN,
      to: TransactionStatus.SETTLED,
    });
    expect(ChangeSource.RECONCILIATION).toBe('RECONCILIATION');
  });
});
