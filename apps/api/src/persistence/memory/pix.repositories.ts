import {
  PIX_CHARGE_STATUS_TRANSITIONS,
  PixKeyStatus,
  TRANSACTION_STATUS_RANKS,
  TRANSACTION_STATUS_TRANSITIONS,
  TransactionStatus,
  checkTransition,
  decideMonotonic,
  type Environment,
} from '@baasconn/taxonomy';

import type {
  ListTransactionsFilter,
  OperationRecord,
  OperationRepository,
  PixChargeRecord,
  PixChargeRepository,
  PixKeyRecord,
  PixKeyRepository,
  StatementFilter,
  TransactionRecord,
  TransactionRepository,
} from '../../pix/pix.types.js';

/**
 * Repositorios de dinheiro em memoria.
 *
 * Mesma razao dos de conta: a suite de ponta a ponta exercita controller,
 * guard, adapter, ledger sombra e outbox sem Postgres. A decisao monotonica e
 * a checagem de transicao sao as MESMAS chamadas da versao Prisma — e o que
 * impede as duas implementacoes de divergirem numa regra de dominio.
 *
 * O que aqui NAO e real: atomicidade. `withinTransaction` roda em sequencia.
 * As constraints continuam provadas por SQL puro sobre PGlite.
 */
export class MemoryTransactionRepository implements TransactionRepository {
  readonly rows = new Map<string, TransactionRecord>();
  readonly statusHistory: Array<{
    transactionId: string;
    from: TransactionStatus;
    to: TransactionStatus;
  }> = [];

  async findById(environment: Environment, id: string) {
    const row = this.rows.get(id);
    return row?.environment === environment ? row : undefined;
  }

  async findByProviderTransactionId(
    environment: Environment,
    provider: string,
    providerTransactionId: string,
  ) {
    return [...this.rows.values()].find(
      (row) =>
        row.environment === environment &&
        row.provider === provider &&
        row.providerTransactionId === providerTransactionId,
    );
  }

  async findByEndToEndId(environment: Environment, endToEndId: string) {
    return [...this.rows.values()].find(
      (row) => row.environment === environment && row.pix?.endToEndId === endToEndId,
    );
  }

  async findByIdempotencyKey(environment: Environment, idempotencyKey: string) {
    return [...this.rows.values()].find(
      (row) => row.environment === environment && row.idempotencyKey === idempotencyKey,
    );
  }

  async create(record: TransactionRecord) {
    const stored: TransactionRecord = {
      ...record,
      pix: record.pix ? { ...record.pix } : null,
      metadata: { ...record.metadata },
    };
    this.rows.set(stored.id, stored);
    return stored;
  }

  async list(filter: ListTransactionsFilter) {
    const all = [...this.rows.values()]
      .filter((row) => row.environment === filter.environment)
      .filter((row) => !filter.accountId || row.accountId === filter.accountId)
      .filter((row) => !filter.status || row.status === filter.status)
      .filter((row) => !filter.direction || row.direction === filter.direction)
      .filter((row) => !filter.endToEndId || row.pix?.endToEndId === filter.endToEndId)
      .sort((a, b) => b.id.localeCompare(a.id));

    const start = filter.cursor ? all.findIndex((row) => row.id === filter.cursor) + 1 : 0;
    const page = all.slice(start, start + filter.limit);
    const nextCursor = start + filter.limit < all.length ? page.at(-1)?.id : undefined;
    return { data: page, nextCursor };
  }

  async statement(filter: StatementFilter) {
    const cursor = filter.cursor;

    const all = [...this.rows.values()]
      .filter((row) => row.environment === filter.environment)
      .filter((row) => row.accountId === filter.accountId)
      .filter((row) => filter.statuses.includes(row.status))
      .filter((row) => row.effectiveDate >= filter.from && row.effectiveDate <= filter.to)
      // Mesma ordem do indice: data desc, id desc.
      .sort((a, b) =>
        a.effectiveDate === b.effectiveDate
          ? b.id.localeCompare(a.id)
          : b.effectiveDate.localeCompare(a.effectiveDate),
      )
      .filter((row) => {
        if (!cursor) return true;
        if (row.effectiveDate < cursor.date) return true;
        return row.effectiveDate === cursor.date && row.id < cursor.id;
      });

    const page = all.slice(0, filter.limit);
    const last = page.at(-1);
    return {
      data: page,
      nextCursor:
        all.length > filter.limit && last
          ? { date: last.effectiveDate, id: last.id }
          : undefined,
    };
  }

  async applyStatusChange(input: Parameters<TransactionRepository['applyStatusChange']>[0]) {
    const row = this.rows.get(input.transactionId);
    if (!row || row.environment !== input.environment) {
      return { applied: false, reason: 'not_found' as const };
    }

    const decision = decideMonotonic({
      current: row.status,
      incoming: input.toStatus,
      ranks: TRANSACTION_STATUS_RANKS,
      occurredAt: input.occurredAt,
      lastEventAt: row.lastEventAt,
    });
    if (!decision.apply) {
      return { applied: false, reason: decision.reason, currentStatus: row.status };
    }

    const legal = checkTransition(TRANSACTION_STATUS_TRANSITIONS, row.status, input.toStatus);
    if (!legal.allowed) {
      return { applied: false, reason: 'illegal_transition' as const, currentStatus: row.status };
    }

    const from = row.status;
    row.status = input.toStatus;
    row.lastEventAt = input.occurredAt;
    row.failureCode = input.failureCode ?? row.failureCode;
    row.providerFailureCode = input.providerFailureCode ?? row.providerFailureCode;
    row.failureMessage = input.failureMessage ?? row.failureMessage;
    row.settledAt = input.settledAt ?? row.settledAt;
    row.ledgerPostedTransactionId =
      input.ledgerPostedTransactionId ?? row.ledgerPostedTransactionId;
    if (input.toStatus === TransactionStatus.FAILED) row.failedAt = input.occurredAt;
    if (input.endToEndId && row.pix) {
      row.pix.endToEndId = input.endToEndId;
      row.pix.settlementAt = input.settledAt ?? row.pix.settlementAt;
    }
    row.updatedAt = input.occurredAt;

    this.statusHistory.push({ transactionId: row.id, from, to: input.toStatus });
    await input.withinTransaction?.(row.id);

    return { applied: true, record: row };
  }

  async attachProviderTransaction(
    input: Parameters<TransactionRepository['attachProviderTransaction']>[0],
  ) {
    const row = this.rows.get(input.transactionId);
    if (!row) throw new Error(`Transacao ${input.transactionId} nao encontrada`);

    row.providerTransactionId = input.providerTransactionId;
    row.status = input.status;
    if (input.endToEndId && row.pix) row.pix.endToEndId = input.endToEndId;
    row.updatedAt = new Date();
    return row;
  }
}

export class MemoryPixKeyRepository implements PixKeyRepository {
  readonly rows = new Map<string, PixKeyRecord>();

  async findById(environment: Environment, id: string) {
    const row = this.rows.get(id);
    return row?.environment === environment ? row : undefined;
  }

  async listByAccount(environment: Environment, accountId: string) {
    return [...this.rows.values()]
      .filter((row) => row.environment === environment && row.accountId === accountId)
      .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime());
  }

  async findActiveByBlindIndex(environment: Environment, blindIndex: string) {
    return [...this.rows.values()].find(
      (row) =>
        row.environment === environment &&
        row.valueBlindIndex === blindIndex &&
        row.status === PixKeyStatus.ACTIVE,
    );
  }

  async create(record: PixKeyRecord) {
    this.rows.set(record.id, { ...record });
    return record;
  }

  async markRemoved(environment: Environment, id: string, at: Date) {
    const row = this.rows.get(id);
    if (!row || row.environment !== environment) return;
    row.status = PixKeyStatus.REMOVED;
    row.removedAt = at;
  }
}

export class MemoryPixChargeRepository implements PixChargeRepository {
  readonly rows = new Map<string, PixChargeRecord>();

  async findByTxid(environment: Environment, txid: string) {
    return [...this.rows.values()].find(
      (row) => row.environment === environment && row.txid === txid,
    );
  }

  async listByAccount(environment: Environment, accountId: string, limit: number) {
    return [...this.rows.values()]
      .filter((row) => row.environment === environment && row.accountId === accountId)
      .sort((a, b) => b.id.localeCompare(a.id))
      .slice(0, limit);
  }

  async create(record: PixChargeRecord) {
    this.rows.set(record.id, { ...record, metadata: { ...record.metadata } });
    return record;
  }

  async applyStatusChange(input: Parameters<PixChargeRepository['applyStatusChange']>[0]) {
    const row = await this.findByTxid(input.environment, input.txid);
    if (!row) return { applied: false, reason: 'not_found' as const };

    if (row.lastEventAt && row.lastEventAt > input.occurredAt) {
      return { applied: false, reason: 'stale_timestamp' as const };
    }
    if (row.status === input.toStatus) return { applied: false, reason: 'same_state' as const };

    const legal = checkTransition(PIX_CHARGE_STATUS_TRANSITIONS, row.status, input.toStatus);
    if (!legal.allowed) return { applied: false, reason: 'illegal_transition' as const };

    row.status = input.toStatus;
    row.paidAmountCents = input.paidAmountCents ?? row.paidAmountCents;
    row.paidAt = input.paidAt ?? row.paidAt;
    row.lastEventAt = input.occurredAt;
    row.revision += 1;
    row.updatedAt = input.occurredAt;

    await input.withinTransaction?.(row.id);

    return { applied: true, record: row };
  }
}

export class MemoryOperationRepository implements OperationRepository {
  readonly rows = new Map<string, OperationRecord>();

  async findById(environment: Environment, id: string) {
    const row = this.rows.get(id);
    return row?.environment === environment ? row : undefined;
  }

  async create(record: OperationRecord) {
    this.rows.set(record.id, { ...record });
    return record;
  }

  async update(input: Parameters<OperationRepository['update']>[0]) {
    const row = this.rows.get(input.id);
    if (!row || row.environment !== input.environment) return undefined;

    row.status = input.status ?? row.status;
    row.providerRef = input.providerRef ?? row.providerRef;
    row.endToEndId = input.endToEndId ?? row.endToEndId;
    row.lastError = input.lastError ?? row.lastError;
    if (input.incrementAttempts) row.attempts += 1;
    row.updatedAt = new Date();
    return row;
  }

  async findStuck(environment: Environment, limit: number) {
    const priority: Record<string, number> = { UNKNOWN: 0, SUBMITTED: 1 };
    return [...this.rows.values()]
      .filter((row) => row.environment === environment && row.status in priority)
      .sort(
        (a, b) =>
          priority[a.status]! - priority[b.status]! ||
          a.updatedAt.getTime() - b.updatedAt.getTime(),
      )
      .slice(0, limit);
  }
}
