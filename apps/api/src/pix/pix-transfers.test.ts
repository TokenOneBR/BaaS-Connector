import { BlindIndex } from '@baasconn/crypto';
import { computeBalances } from '@baasconn/ledger';
import type { PixTransaction } from '@baasconn/provider-spi';
import {
  AccountKind,
  AccountStatus,
  BaasError,
  BaasErrorCode,
  Environment,
  FixedClock,
  Money,
  PixPurpose,
  ProviderOutcomeUnknownError,
  TransactionStatus,
  newId,
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

import { PixTransfersService } from './pix-transfers.service.js';

const ENV = Environment.HOMOLOGACAO;
const PEPPER = 'pepper-de-teste-com-mais-de-trinta-e-dois-caracteres';
const DESTINO = 'destino@exemplo.test';

describe('PIX out', () => {
  let clock: FixedClock;
  let ledger: ShadowLedgerService;
  let ledgerFactory: MemoryLedgerStoreFactory;
  let transactions: MemoryTransactionRepository;
  let operations: MemoryOperationRepository;
  let service: PixTransfersService;
  let account: AccountRecord;
  let send: ReturnType<typeof vi.fn>;
  let enfileirados: unknown[];
  let findByIdempotencyKey: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    clock = new FixedClock(new Date('2026-08-29T12:00:00.000Z'));
    ledgerFactory = new MemoryLedgerStoreFactory(clock);
    ledger = new ShadowLedgerService(ledgerFactory, clock);
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

    // Saldo de R$ 1.000,00.
    await ledger.creditIn({
      environment: ENV,
      availableId: ledgerAccounts.availableId,
      amountCents: 100_000n,
      idempotencyKey: 'saldo-inicial',
    });

    send = vi.fn(async (): Promise<PixTransaction> => ({
      providerTransactionId: 'mb-txn-1',
      status: TransactionStatus.PENDING,
      direction: 'out',
      amount: Money.of(50_000n).toJSON(),
      createdAt: clock.now().toISOString(),
    }));
    findByIdempotencyKey = vi.fn(async () => null);

    const providers = {
      require: vi.fn(async () => ({
        slug: 'mock-bank',
        adapter: { pixTransfers: { send, findByIdempotencyKey, get: vi.fn() } },
      })),
    };

    // A escada do desfecho desconhecido comeca pelo caminho quente.
    enfileirados = [];
    const fila = {
      enqueue: async (job: unknown) => void enfileirados.push(job),
      drain: async () => undefined,
    } as never;

    service = new PixTransfersService(
      providers as never,
      ledger,
      new BlindIndex(PEPPER),
      accounts,
      transactions,
      operations,
      new MemoryOutboxRepository(),
      fila,
      new InMemoryCacheStore(clock),
      clock,
    );
  });

  const actor = (operationId = newId('operation')) => ({
    environment: ENV,
    connectionId: 'con_1',
    apiKeyId: 'key_1',
    scopes: ['pix:write'] as const,
    operationId,
  });

  const dto = (cents: bigint) => ({
    amount: Money.of(cents).toJSON(),
    destination: { kind: 'pix_key' as const, key: DESTINO },
    purpose: PixPurpose.TRANSFER,
    metadata: {},
  });

  const available = () => {
    const found = ledgerFactory
      .for(ENV)
      .snapshot()
      .accounts.find((row) => row.id === account.ledgerAvailableAccountId);
    return computeBalances(found!);
  };

  it('autoriza o hold ANTES de chamar o provedor', async () => {
    // A ordem e a decisao que importa: se o hold viesse depois da resposta,
    // duas transferencias concorrentes veriam o saldo cheio, e e assim que se
    // paga duas vezes.
    let saldoDuranteChamada = -1n;
    send.mockImplementation(async () => {
      saldoDuranteChamada = available().available;
      return {
        providerTransactionId: 'mb-txn-1',
        status: TransactionStatus.PENDING,
        direction: 'out' as const,
        amount: Money.of(50_000n).toJSON(),
        createdAt: clock.now().toISOString(),
      };
    });

    await service.send(actor(), account.id, dto(50_000n));
    expect(saldoDuranteChamada).toBe(50_000n);
  });

  it('saldo insuficiente falha sem chamar o provedor', async () => {
    await expect(service.send(actor(), account.id, dto(150_000n))).rejects.toMatchObject({
      code: BaasErrorCode.INSUFFICIENT_FUNDS,
    });
    expect(send).not.toHaveBeenCalled();
    expect(transactions.rows.size).toBe(0);
    // Sem lancamento: o hold que falhou nao deixa residuo no razao.
    expect(available().available).toBe(100_000n);
  });

  it('recusa deterministica libera o hold', async () => {
    send.mockRejectedValue(
      new BaasError(BaasErrorCode.PROVIDER_REJECTED, { message: 'chave invalida' }),
    );

    await expect(service.send(actor(), account.id, dto(50_000n))).rejects.toBeInstanceOf(BaasError);
    // O provedor decidiu, nao ha o que reconciliar: segurar saldo do cliente
    // por um pagamento que comprovadamente nao aconteceu e defeito visivel.
    expect(available().available).toBe(100_000n);
  });

  it('desfecho desconhecido MANTEM o hold e devolve operacao em UNKNOWN', async () => {
    send.mockRejectedValue(new ProviderOutcomeUnknownError('mock-bank', 'timeout na escrita'));

    const outcome = await service.send(actor(), account.id, dto(50_000n));

    expect(outcome.kind).toBe('accepted');
    // O hold segue de pe: liberar devolveria ao cliente um saldo que talvez ja
    // tenha saido, e ele gastaria duas vezes o mesmo dinheiro.
    expect(available().available).toBe(50_000n);
    expect(outcome.transaction.status).toBe(TransactionStatus.UNKNOWN);
    if (outcome.kind === 'accepted') expect(outcome.operation.status).toBe('UNKNOWN');
  });

  it('desfecho desconhecido enfileira o degrau 0 da escada', async () => {
    // Sem o empurrao do caminho quente, o desfecho so seria consultado na
    // proxima varredura do worker — com o saldo do cliente travado ate la.
    send.mockRejectedValue(new ProviderOutcomeUnknownError('mock-bank', 'timeout na escrita'));
    await service.send(actor(), account.id, dto(50_000n));

    expect(enfileirados).toContainEqual(
      expect.objectContaining({ kind: 'operation_resolve', step: 0 }),
    );
  });

  it('desfecho desconhecido nao apaga a transacao', async () => {
    send.mockRejectedValue(new ProviderOutcomeUnknownError('mock-bank', 'timeout'));
    const outcome = await service.send(actor(), account.id, dto(50_000n));

    // Sem linha nossa, a conciliacao nao teria o que procurar e o dinheiro
    // sairia sem deixar rastro.
    const stored = await transactions.findById(ENV, outcome.transaction.id);
    expect(stored?.ledgerPendingTransactionId).toBeTruthy();
    expect(stored?.idempotencyKey).toBe(outcome.transaction.operationId);
  });

  it('roubo de lease consulta o provedor antes de reenviar', async () => {
    const operationId = newId('operation');
    findByIdempotencyKey.mockResolvedValue({
      providerTransactionId: 'mb-txn-ja-existia',
      status: TransactionStatus.SETTLED,
      direction: 'out',
      amount: Money.of(50_000n).toJSON(),
      createdAt: clock.now().toISOString(),
    });

    await service.send(actor(operationId), account.id, dto(50_000n), { reconcileFirst: true });

    // Nao reenviou: reenviar sem consultar e o caminho direto para o pagamento
    // duplo, porque a tentativa anterior pode ter chegado la.
    expect(send).not.toHaveBeenCalled();
    expect(findByIdempotencyKey).toHaveBeenCalledWith(expect.anything(), operationId);
    // E nao autorizou um segundo hold.
    expect(available().available).toBe(100_000n);
  });

  it('duas transferencias concorrentes nao gastam o mesmo saldo duas vezes', async () => {
    // Saldo para uma so.
    const [primeira, segunda] = await Promise.allSettled([
      service.send(actor(), account.id, dto(60_000n)),
      service.send(actor(), account.id, dto(60_000n)),
    ]);

    const ok = [primeira, segunda].filter((r) => r.status === 'fulfilled');
    const falhou = [primeira, segunda].filter((r) => r.status === 'rejected');

    expect(ok).toHaveLength(1);
    expect(falhou).toHaveLength(1);
    expect(available().available).toBe(40_000n);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('parseia BR Code estatico para chave antes de sair', async () => {
    // Repassar o payload cru deixaria cada adapter reimplementando o codec do
    // BACEN, e um deles erraria — mandando o dinheiro para a chave errada com
    // um QR sintaticamente valido.
    const { buildBrCode } = await import('@baasconn/taxonomy');
    const emv = buildBrCode({ pixKey: DESTINO, merchantName: 'LOJA', merchantCity: 'SP' });

    await service.send(actor(), account.id, {
      ...dto(10_000n),
      destination: { kind: 'emv', payload: emv },
    });

    expect(send.mock.calls[0]![1].destination).toMatchObject({
      kind: 'pix_key',
      key: DESTINO,
    });
  });

  it('BR Code adulterado e recusado antes do hold', async () => {
    const { buildBrCode } = await import('@baasconn/taxonomy');
    const emv = buildBrCode({ pixKey: DESTINO, merchantName: 'LOJA', merchantCity: 'SP' });

    await expect(
      service.send(actor(), account.id, {
        ...dto(10_000n),
        destination: { kind: 'emv', payload: `${emv.slice(0, -4)}0000` },
      }),
    ).rejects.toMatchObject({ code: BaasErrorCode.INVALID_EMV_PAYLOAD });

    expect(available().available).toBe(100_000n);
  });
});
