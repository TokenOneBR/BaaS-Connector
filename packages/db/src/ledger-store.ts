import {
  type EntryPhase,
  type LedgerAccountStatus,
  type LedgerTransactionStatus,
  type LedgerAccount,
  type LedgerEntry,
  type LedgerStore,
  type LedgerTransaction,
  type PostTransactionResult,
} from '@baasconn/ledger';
import type { CurrencyCode, Environment } from '@baasconn/taxonomy';

import type { PrismaClient } from './client.js';

/**
 * Store Postgres do razao.
 *
 * Implementa o port declarado em `packages/ledger`. O MOTOR continua sendo o
 * unico lugar que decide o que lancar — e o mesmo motor que o Mock Bank usa,
 * e ter dois e como os dois razoes passam a discordar. Aqui so vive a ligacao
 * com o banco: o lock e a escrita.
 *
 * As invariantes NAO sao reimplementadas: balanceamento e um trigger
 * DEFERRABLE, saldo nao-negativo e um CHECK, imutabilidade de lancamento e um
 * trigger de mutacao. O que a aplicacao faz e falhar antes com mensagem util;
 * o que garante a propriedade e o banco.
 */
export class PrismaLedgerStore implements LedgerStore {
  constructor(
    private readonly client: PrismaClient,
    private readonly environment: Environment,
    private readonly currency: CurrencyCode = 'BRL',
  ) {}

  /**
   * Trava as contas na ordem recebida.
   *
   * `SELECT ... FOR UPDATE` cru porque o Prisma nao expoe lock pessimista na
   * API fluente. A ORDEM vem do motor (`lockOrder`, ordenada por id) e e o que
   * elimina o deadlock A->B / B->A: duas transferencias cruzadas travam as
   * mesmas linhas na mesma sequencia.
   *
   * `ORDER BY id` e repetido no SQL porque `= ANY($1)` nao preserva a ordem do
   * array — o Postgres decide o plano, e sem o ORDER BY a garantia se perde.
   */
  async lockAccounts(orderedIds: readonly string[]): Promise<Map<string, LedgerAccount>> {
    if (orderedIds.length === 0) return new Map();

    const rows = await this.client.$queryRaw<LedgerAccountRow[]>`
      SELECT id, code, name, type, normal_balance, currency, owner_type, owner_id,
             status, allows_negative, debits_posted, credits_posted,
             debits_pending, credits_pending, entry_count, version
      FROM ledger_account
      WHERE id = ANY(${[...orderedIds]}::text[])
        AND environment = ${this.environment}::"Environment"
      ORDER BY id
      FOR UPDATE`;

    const locked = new Map<string, LedgerAccount>();
    for (const row of rows) locked.set(row.id, toAccount(row));
    return locked;
  }

  async findByIdempotencyKey(key: string): Promise<PostTransactionResult | undefined> {
    const transaction = await this.client.ledgerTransaction.findFirst({
      where: { environment: this.environment, idempotencyKey: key },
    });
    if (!transaction) return undefined;

    return {
      transaction: toTransaction(transaction),
      entries: await this.findEntriesByTransaction(transaction.id),
      replayed: true,
    };
  }

  async findTransaction(id: string): Promise<LedgerTransaction | undefined> {
    const row = await this.client.ledgerTransaction.findFirst({
      where: { environment: this.environment, id },
    });
    return row ? toTransaction(row) : undefined;
  }

  async findEntriesByTransaction(id: string): Promise<LedgerEntry[]> {
    const rows = await this.client.ledgerEntry.findMany({
      where: { environment: this.environment, transactionId: id },
      orderBy: { sequence: 'asc' },
    });
    return rows.map((row) => toEntry(row, this.currency));
  }

  /**
   * Escreve tudo numa unica chamada a `ledger.post_transaction`.
   *
   * A funcao e SECURITY DEFINER porque a aplicacao NAO tem UPDATE nos
   * contadores materializados — o REVOKE da migration de hardening tira essa
   * permissao de proposito, para que nem um script de correcao consiga mover
   * um saldo por fora.
   */
  async persist(
    transaction: LedgerTransaction,
    entries: readonly LedgerEntry[],
    accounts: readonly LedgerAccount[],
  ): Promise<void> {
    await this.client.$queryRaw`
      SELECT ledger.post_transaction(
        ${JSON.stringify(serializeTransaction(transaction, this.environment))}::jsonb,
        ${JSON.stringify(entries.map((entry) => serializeEntry(entry, this.environment)))}::jsonb,
        ${JSON.stringify(accounts.map(serializeAccount))}::jsonb
      )`;
  }

  /**
   * Abre o par de contas de um cliente, se ainda nao existir.
   *
   * Idempotente por `code`: reabrir uma conta ja aberta devolve os mesmos ids,
   * o que importa porque a criacao de conta pode ser reexecutada por retry.
   */
  async ensureAccounts(
    templates: readonly {
      code: string;
      name: string;
      type: string;
      ownerType: string;
      allowsNegative: boolean;
      ownerId?: string;
    }[],
    newAccountId: () => string,
  ): Promise<Map<string, string>> {
    const byCode = new Map<string, string>();

    for (const template of templates) {
      const row = await this.client.ledgerAccount.upsert({
        where: { environment_code: { environment: this.environment, code: template.code } },
        create: {
          id: newAccountId(),
          environment: this.environment,
          code: template.code,
          name: template.name,
          type: template.type as never,
          normalBalance: normalBalanceFor(template.type),
          currency: this.currency,
          ownerType: template.ownerType as never,
          ownerId: template.ownerId,
          allowsNegative: template.allowsNegative,
        },
        update: {},
        select: { id: true, code: true },
      });
      byCode.set(row.code, row.id);
    }

    return byCode;
  }

  async accountIdByCode(code: string): Promise<string | undefined> {
    const row = await this.client.ledgerAccount.findUnique({
      where: { environment_code: { environment: this.environment, code } },
      select: { id: true },
    });
    return row?.id;
  }
}

function normalBalanceFor(type: string): 'DEBIT' | 'CREDIT' {
  return type === 'ASSET' || type === 'EXPENSE' ? 'DEBIT' : 'CREDIT';
}

interface LedgerAccountRow {
  id: string;
  code: string;
  name: string;
  type: string;
  normal_balance: string;
  currency: string;
  owner_type: string;
  owner_id: string | null;
  status: string;
  allows_negative: boolean;
  debits_posted: bigint;
  credits_posted: bigint;
  debits_pending: bigint;
  credits_pending: bigint;
  entry_count: bigint;
  version: bigint;
}

function toAccount(row: LedgerAccountRow): LedgerAccount {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type as LedgerAccount['type'],
    normalBalance: row.normal_balance as LedgerAccount['normalBalance'],
    currency: row.currency as CurrencyCode,
    ownerType: row.owner_type as LedgerAccount['ownerType'],
    ownerId: row.owner_id ?? undefined,
    status: row.status as LedgerAccountStatus,
    allowsNegative: row.allows_negative,
    debitsPosted: row.debits_posted,
    creditsPosted: row.credits_posted,
    debitsPending: row.debits_pending,
    creditsPending: row.credits_pending,
    entryCount: row.entry_count,
    version: row.version,
  };
}

function toTransaction(row: Record<string, unknown>): LedgerTransaction {
  return {
    id: row.id as string,
    type: row.type as LedgerTransaction['type'],
    status: row.status as LedgerTransactionStatus,
    currency: row.currency as CurrencyCode,
    amountCents: row.amountCents as bigint,
    idempotencyKey: row.idempotencyKey as string,
    externalRef: (row.externalRef as string | null) ?? undefined,
    description: (row.description as string | null) ?? undefined,
    pendingTransactionId: (row.pendingTransactionId as string | null) ?? undefined,
    effectiveAt: row.effectiveAt as Date,
    postedAt: (row.postedAt as Date | null) ?? undefined,
    voidedAt: (row.voidedAt as Date | null) ?? undefined,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  };
}

function toEntry(row: Record<string, unknown>, currency: CurrencyCode): LedgerEntry {
  return {
    id: row.id as string,
    transactionId: row.transactionId as string,
    // O DTO do motor chama de `accountId`; a coluna e `ledger_account_id`.
    accountId: row.ledgerAccountId as string,
    direction: row.direction as LedgerEntry['direction'],
    amountCents: row.amountCents as bigint,
    phase: row.phase as EntryPhase,
    currency,
    sequence: row.sequence as number,
    resultingPostedCents: row.resultingPostedCents as bigint,
    effectiveAt: row.effectiveAt as Date,
  };
}

function serializeTransaction(transaction: LedgerTransaction, environment: Environment) {
  return {
    id: transaction.id,
    environment,
    type: transaction.type,
    status: transaction.status,
    currency: transaction.currency,
    // BigInt nao serializa em JSON sem o patch global; string e explicito e
    // o `jsonb_to_record` converte de volta para bigint no lado do banco.
    amount_cents: transaction.amountCents.toString(),
    idempotency_key: transaction.idempotencyKey,
    external_ref: transaction.externalRef ?? null,
    description: transaction.description ?? null,
    pending_transaction_id: transaction.pendingTransactionId ?? null,
    effective_at: transaction.effectiveAt.toISOString(),
    posted_at: transaction.postedAt?.toISOString() ?? null,
    voided_at: transaction.voidedAt?.toISOString() ?? null,
    metadata: transaction.metadata,
  };
}

function serializeEntry(entry: LedgerEntry, environment: Environment) {
  return {
    id: entry.id,
    environment,
    transaction_id: entry.transactionId,
    ledger_account_id: entry.accountId,
    direction: entry.direction,
    amount_cents: entry.amountCents.toString(),
    phase: entry.phase,
    currency: entry.currency,
    sequence: entry.sequence,
    resulting_posted_cents: entry.resultingPostedCents.toString(),
    effective_at: entry.effectiveAt.toISOString(),
  };
}

function serializeAccount(account: LedgerAccount) {
  return {
    id: account.id,
    debits_posted: account.debitsPosted.toString(),
    credits_posted: account.creditsPosted.toString(),
    debits_pending: account.debitsPending.toString(),
    credits_pending: account.creditsPending.toString(),
    entry_count: account.entryCount.toString(),
    last_entry_id: null,
  };
}
