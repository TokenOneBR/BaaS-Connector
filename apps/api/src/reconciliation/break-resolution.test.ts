import { assertInvariants } from '@baasconn/ledger';
import {
  AccountKind,
  AccountStatus,
  BaasError,
  BaasErrorCode,
  BreakSeverity,
  BreakStatus,
  BreakType,
  Environment,
  FixedClock,
  ReconciliationScope,
  ReconciliationSide,
  ResolutionAction,
  TransactionDirection,
  TransactionStatus,
  TransactionType,
  newId,
} from '@baasconn/taxonomy';
import { beforeEach, describe, expect, it } from 'vitest';

import type { AccountRecord } from '../accounts/accounts.types.js';
import { InMemoryCacheStore } from '../cache/memory-cache.store.js';
import { MemoryLedgerStoreFactory } from '../ledger/memory-ledger-store.js';
import { ShadowLedgerService } from '../ledger/shadow-ledger.service.js';
import {
  MemoryAccountRepository,
  MemoryAuditRepository,
} from '../persistence/memory/domain.repositories.js';
import { MemoryTransactionRepository } from '../persistence/memory/pix.repositories.js';
import {
  MemoryReconciliationBreakRepository,
  MemoryReconciliationRunRepository,
} from '../persistence/memory/reconciliation.repositories.js';

import { BreakResolutionService } from './break-resolution.service.js';
import type { BreakUpsertRow } from './reconciliation.types.js';

const ENV = Environment.HOMOLOGACAO;
const CONEXAO = 'con_1';
const NOTA = 'Divergencia conferida com o provedor por telefone.';

describe('resolucao manual de quebra', () => {
  let clock: FixedClock;
  let ledgerFactory: MemoryLedgerStoreFactory;
  let ledger: ShadowLedgerService;
  let breaks: MemoryReconciliationBreakRepository;
  let runs: MemoryReconciliationRunRepository;
  let accounts: MemoryAccountRepository;
  let transactions: MemoryTransactionRepository;
  let audit: MemoryAuditRepository;
  let cache: InMemoryCacheStore;
  let service: BreakResolutionService;
  let account: AccountRecord;
  let disponivel: string;
  let runId: string;

  beforeEach(async () => {
    clock = new FixedClock(new Date('2026-08-30T12:00:00.000Z'));
    ledgerFactory = new MemoryLedgerStoreFactory(clock);
    ledger = new ShadowLedgerService(ledgerFactory, clock);
    breaks = new MemoryReconciliationBreakRepository();
    runs = new MemoryReconciliationRunRepository();
    accounts = new MemoryAccountRepository();
    transactions = new MemoryTransactionRepository();
    audit = new MemoryAuditRepository();
    cache = new InMemoryCacheStore(clock);

    const accountId = newId('account');
    const ledgerAccounts = await ledger.openAccounts(ENV, accountId);
    disponivel = ledgerAccounts.availableId;

    account = {
      id: accountId,
      environment: ENV,
      holderId: newId('holder'),
      provider: 'mock-bank',
      providerConnectionId: CONEXAO,
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
      availableId: disponivel,
      amountCents: 100_000n,
      idempotencyKey: 'saldo-inicial',
    });

    const { run } = await runs.startRun({
      id: newId('reconciliationRun'),
      environment: ENV,
      connectionId: CONEXAO,
      accountId,
      scope: ReconciliationScope.DAILY,
      windowStart: new Date('2026-08-29T03:00:00.000Z'),
      windowEnd: new Date('2026-08-30T03:00:00.000Z'),
      triggeredBy: 'test',
    });
    runId = run.id;

    service = new BreakResolutionService(
      ledger,
      breaks,
      runs,
      accounts,
      transactions,
      audit,
      cache,
      clock,
    );
  });

  const abrirQuebra = async (overrides: Partial<BreakUpsertRow> = {}): Promise<string> => {
    const id = newId('reconciliationBreak');
    const row: BreakUpsertRow = {
      id,
      environment: ENV,
      runId,
      connectionId: CONEXAO,
      accountId: account.id,
      type: BreakType.AMOUNT_MISMATCH,
      severity: BreakSeverity.HIGH,
      dedupeKey: `e2e:${id}`,
      effectiveDate: '2026-08-29',
      amountCents: 50_000n,
      deltaCents: 2_500n,
      description: 'Valor divergente entre provedor e registro local.',
      evidence: {},
      ...overrides,
    };
    const [resultado] = await breaks.upsertMany([row], clock.now());
    return resultado!.id;
  };

  const saldo = async () => (await ledger.balances(ENV, disponivel)).posted;

  const invariantes = () => {
    const { accounts: todas, entries } = ledgerFactory.for(ENV).snapshot();
    assertInvariants(todas, entries);
  };

  // ------------------------------------------------------------------------
  // CREATE_LEDGER_ADJUSTMENT — o unico clique que move dinheiro
  // ------------------------------------------------------------------------

  it('lanca ajuste balanceado e grava o id na quebra', async () => {
    const id = await abrirQuebra();

    const resolvida = await service.resolve({
      environment: ENV,
      breakId: id,
      action: ResolutionAction.CREATE_LEDGER_ADJUSTMENT,
      note: NOTA,
      resolvedBy: 'usr_admin',
    });

    // Delta positivo: o provedor tem MAIS do que nos, entao falta creditar.
    expect(await saldo()).toBe(102_500n);
    expect(resolvida.status).toBe(BreakStatus.RESOLVED);
    expect(resolvida.adjustmentTransactionId).toBeTruthy();
    invariantes();
  });

  it('delta negativo debita o cliente', async () => {
    const id = await abrirQuebra({ deltaCents: -2_500n });

    await service.resolve({
      environment: ENV,
      breakId: id,
      action: ResolutionAction.CREATE_LEDGER_ADJUSTMENT,
      note: NOTA,
      resolvedBy: 'usr_admin',
    });

    expect(await saldo()).toBe(97_500n);
    invariantes();
  });

  it('nao edita o historico: o ajuste e uma transacao NOVA', async () => {
    const antes = ledgerFactory.for(ENV).snapshot().entries.length;
    const id = await abrirQuebra();

    await service.resolve({
      environment: ENV,
      breakId: id,
      action: ResolutionAction.CREATE_LEDGER_ADJUSTMENT,
      note: NOTA,
      resolvedBy: 'usr_admin',
    });

    // Duas pernas a mais, e nenhuma perna anterior alterada.
    expect(ledgerFactory.for(ENV).snapshot().entries.length).toBe(antes + 2);
  });

  /**
   * A propriedade central do commit.
   *
   * A chave de idempotencia e da QUEBRA (`recon-adjust:<id>`), nao do clique.
   * Duplo clique, retry de rede ou dois operadores na mesma quebra postam UMA
   * vez — o conserto de um erro de dinheiro nao pode virar um segundo erro de
   * dinheiro.
   */
  it('resolver a mesma quebra duas vezes nao lanca dois ajustes', async () => {
    const id = await abrirQuebra();

    await service.resolve({
      environment: ENV,
      breakId: id,
      action: ResolutionAction.CREATE_LEDGER_ADJUSTMENT,
      note: NOTA,
      resolvedBy: 'usr_admin',
    });

    // Segundo clique: recusado ANTES de qualquer efeito.
    await expect(
      service.resolve({
        environment: ENV,
        breakId: id,
        action: ResolutionAction.CREATE_LEDGER_ADJUSTMENT,
        note: NOTA,
        resolvedBy: 'usr_outro_admin',
      }),
    ).rejects.toMatchObject({ code: BaasErrorCode.RESOURCE_ALREADY_EXISTS });

    expect(await saldo()).toBe(102_500n);
    invariantes();
  });

  /**
   * A rede de baixo: mesmo se a guarda de status falhar, o razao resolve por
   * `findByIdempotencyKey` e o dinheiro so se move uma vez.
   *
   * Este teste chama o razao direto de proposito — e a prova de que a
   * idempotencia nao depende do fluxo de status acima dela.
   */
  it('a chave da quebra torna o ajuste idempotente no proprio razao', async () => {
    const id = await abrirQuebra();

    await service.resolve({
      environment: ENV,
      breakId: id,
      action: ResolutionAction.CREATE_LEDGER_ADJUSTMENT,
      note: NOTA,
      resolvedBy: 'usr_admin',
    });

    const repetido = await ledger.adjust({
      environment: ENV,
      availableId: disponivel,
      amountCents: 2_500n,
      direction: 'CREDIT',
      idempotencyKey: `recon-adjust:${id}`,
    });

    expect(repetido.replayed).toBe(true);
    expect(await saldo()).toBe(102_500n);
  });

  it('quebra sem conta nao gera ajuste', async () => {
    const id = await abrirQuebra({ deltaCents: 0n, amountCents: 0n });

    await expect(
      service.resolve({
        environment: ENV,
        breakId: id,
        action: ResolutionAction.CREATE_LEDGER_ADJUSTMENT,
        note: NOTA,
        resolvedBy: 'usr_admin',
      }),
    ).rejects.toBeInstanceOf(BaasError);

    // E o mais importante: a quebra segue ABERTA, nao meio-resolvida.
    expect((await breaks.findById(ENV, id))?.status).toBe(BreakStatus.OPEN);
  });

  // ------------------------------------------------------------------------
  // As outras sete acoes
  // ------------------------------------------------------------------------

  it('WRITE_OFF fecha como aceita e a reincidencia NAO reabre', async () => {
    const id = await abrirQuebra();
    const quebra = await breaks.findById(ENV, id);

    await service.resolve({
      environment: ENV,
      breakId: id,
      action: ResolutionAction.WRITE_OFF,
      note: NOTA,
      resolvedBy: 'usr_admin',
    });

    // A conciliacao de amanha ve a mesma divergencia de novo.
    await breaks.upsertMany(
      [
        {
          ...(quebra as unknown as BreakUpsertRow),
          runId,
          description: 'Mesma divergencia, execucao seguinte.',
        },
      ],
      clock.now(),
    );

    // `WRITTEN_OFF` permanece: e o operador dizendo "conhecido e aceito", e
    // reabrir todo dia transformaria a decisao dele em ruido.
    expect((await breaks.findById(ENV, id))?.status).toBe(BreakStatus.WRITTEN_OFF);
  });

  it('ESCALATE_TO_PROVIDER nao fecha a quebra', async () => {
    const id = await abrirQuebra();

    const resolvida = await service.resolve({
      environment: ENV,
      breakId: id,
      action: ResolutionAction.ESCALATE_TO_PROVIDER,
      note: NOTA,
      resolvedBy: 'usr_admin',
      assignTo: 'suporte@celcoin.test',
    });

    // Escalar e dizer "ainda estamos nisto". Fechar aqui esconderia do painel
    // exatamente a quebra que continua sem resposta.
    expect(resolvida.status).toBe(BreakStatus.INVESTIGATING);
    expect(resolvida.assignedTo).toBe('suporte@celcoin.test');
  });

  it('escalada nao bloqueia uma resolucao posterior', async () => {
    const id = await abrirQuebra();

    await service.resolve({
      environment: ENV,
      breakId: id,
      action: ResolutionAction.ESCALATE_TO_PROVIDER,
      note: NOTA,
      resolvedBy: 'usr_admin',
    });

    const resolvida = await service.resolve({
      environment: ENV,
      breakId: id,
      action: ResolutionAction.CREATE_LEDGER_ADJUSTMENT,
      note: 'O provedor confirmou a diferenca por escrito.',
      resolvedBy: 'usr_admin',
    });

    expect(resolvida.status).toBe(BreakStatus.RESOLVED);
    expect(await saldo()).toBe(102_500n);
  });

  it('IGNORE_TIMING_DIFFERENCE e MERGE_DUPLICATE nao movem dinheiro', async () => {
    for (const action of [
      ResolutionAction.IGNORE_TIMING_DIFFERENCE,
      ResolutionAction.MERGE_DUPLICATE,
    ]) {
      const id = await abrirQuebra();
      const resolvida = await service.resolve({
        environment: ENV,
        breakId: id,
        action,
        note: NOTA,
        resolvedBy: 'usr_admin',
      });
      expect(resolvida.status).toBe(BreakStatus.RESOLVED);
    }

    expect(await saldo()).toBe(100_000n);
  });

  // ------------------------------------------------------------------------
  // CANCEL_LOCAL_RECORD
  // ------------------------------------------------------------------------

  const semearTransacaoLocal = async (status: TransactionStatus): Promise<string> => {
    const transactionId = newId('transaction');
    await transactions.create({
      id: transactionId,
      environment: ENV,
      accountId: account.id,
      type: TransactionType.PIX_OUT,
      direction: TransactionDirection.DEBIT,
      status,
      amountCents: 50_000n,
      feeCents: 0n,
      netAmountCents: 50_000n,
      refundedAmountCents: 0n,
      currency: 'BRL',
      provider: 'mock-bank',
      providerConnectionId: CONEXAO,
      effectiveDate: '2026-08-29',
      requestedAt: clock.now(),
      metadata: {},
      createdAt: clock.now(),
      updatedAt: clock.now(),
    });

    // O item de conciliacao: `externalId` do lado LOCAL E o id da transacao.
    const itemId = newId('reconciliationItem');
    await runs.insertItems([
      {
        id: itemId,
        runId,
        side: ReconciliationSide.LOCAL,
        externalId: transactionId,
        postedAt: clock.now(),
        effectiveDate: '2026-08-29',
        direction: 'DEBIT',
        amountCents: 50_000n,
        type: 'PIX_OUT',
        matchKeyFuzzy: 'fuzzy',
        raw: {},
      },
    ]);

    return itemId;
  };

  it('cancela o registro local pelo item, nao pelo id do item', async () => {
    const itemId = await semearTransacaoLocal(TransactionStatus.PENDING);
    const id = await abrirQuebra({
      type: BreakType.MISSING_ON_PROVIDER,
      localItemId: itemId,
    });

    await service.resolve({
      environment: ENV,
      breakId: id,
      action: ResolutionAction.CANCEL_LOCAL_RECORD,
      note: NOTA,
      resolvedBy: 'usr_admin',
    });

    const transactionId = (await runs.findItemById(itemId))!.externalId!;
    expect((await transactions.findById(ENV, transactionId))?.status).toBe(
      TransactionStatus.CANCELLED,
    );
  });

  it('transicao ilegal devolve 422 em vez de forcar', async () => {
    const itemId = await semearTransacaoLocal(TransactionStatus.SETTLED);
    const id = await abrirQuebra({
      type: BreakType.MISSING_ON_PROVIDER,
      localItemId: itemId,
    });

    // Uma transacao ja liquidada nao vira cancelada por decisao de painel:
    // isso e um ajuste de razao, que e outra acao.
    await expect(
      service.resolve({
        environment: ENV,
        breakId: id,
        action: ResolutionAction.CANCEL_LOCAL_RECORD,
        note: NOTA,
        resolvedBy: 'usr_admin',
      }),
    ).rejects.toMatchObject({ code: BaasErrorCode.VALIDATION_ERROR });

    const transactionId = (await runs.findItemById(itemId))!.externalId!;
    expect((await transactions.findById(ENV, transactionId))?.status).toBe(
      TransactionStatus.SETTLED,
    );
    expect((await breaks.findById(ENV, id))?.status).toBe(BreakStatus.OPEN);
  });

  // ------------------------------------------------------------------------
  // Trilha e isolamento
  // ------------------------------------------------------------------------

  it('toda resolucao escreve auditoria com before e after', async () => {
    const id = await abrirQuebra();

    await service.resolve({
      environment: ENV,
      breakId: id,
      action: ResolutionAction.CREATE_LEDGER_ADJUSTMENT,
      note: NOTA,
      resolvedBy: 'usr_admin',
    });

    const [linha] = audit.forResource(id);
    expect(linha).toMatchObject({
      action: 'reconciliation.break.create_ledger_adjustment',
      actorId: 'usr_admin',
      before: { status: BreakStatus.OPEN },
      after: { status: BreakStatus.RESOLVED },
    });
    expect((linha!.after as Record<string, unknown>).adjustment_transaction_id).toBeTruthy();
  });

  /**
   * A sessao de console nao carrega ambiente, entao ele vem da consulta — e
   * um id de producao numa sessao de homologacao nao pode achar a quebra.
   */
  it('nao alcanca quebra de outro ambiente', async () => {
    const id = await abrirQuebra();

    await expect(
      service.resolve({
        environment: Environment.PRODUCAO,
        breakId: id,
        action: ResolutionAction.WRITE_OFF,
        note: NOTA,
        resolvedBy: 'usr_admin',
      }),
    ).rejects.toMatchObject({ code: BaasErrorCode.RESOURCE_NOT_FOUND });

    expect((await breaks.findById(ENV, id))?.status).toBe(BreakStatus.OPEN);
  });
});
