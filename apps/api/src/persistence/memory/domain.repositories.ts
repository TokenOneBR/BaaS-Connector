import {
  ACCOUNT_STATUS_RANKS,
  ACCOUNT_STATUS_TRANSITIONS,
  AccountStatus,
  ONBOARDING_STATUS_RANKS,
  ONBOARDING_STATUS_TRANSITIONS,
  OnboardingStatus,
  RequirementStatus,
  checkTransition,
  decideMonotonic,
  newId,
  type Environment,
} from '@baasconn/taxonomy';

import type {
  AccountRecord,
  AccountRepository,
  HolderRecord,
  HolderRepository,
  ListAccountsFilter,
  OnboardingRecord,
  OnboardingRepository,
} from '../../accounts/accounts.types.js';
import type {
  AuditDraft,
  AuditRepository,
  OutboxDraft,
  OutboxRepository,
} from '../../events/outbox.types.js';
import type { InboundEventRecord, InboundEventRepository } from '../../webhooks/webhooks.types.js';

/**
 * Repositorios em memoria.
 *
 * Existem pelo mesmo motivo do `MOCK_BANK_STORE=memory`: a suite de ponta a
 * ponta sobe a API inteira sobre sockets reais em milissegundos, sem Postgres.
 *
 * NAO servem para producao — nao ha durabilidade, nem transacao de verdade, e
 * `withinTransaction` roda em sequencia em vez de atomicamente. O que eles
 * exercitam de verdade e o CAMINHO: controller, guard, adapter, mapeamento,
 * guard monotonico, outbox e auditoria. O SQL continua provado a parte, por
 * teste de invariante sobre PGlite.
 */
export class MemoryHolderRepository implements HolderRepository {
  readonly rows = new Map<string, HolderRecord>();
  private readonly envelopes = new Map<
    string,
    Parameters<HolderRepository['create']>[0]['taxIdEnvelope']
  >();

  async findByTaxIdBlindIndex(environment: Environment, blindIndex: string) {
    return [...this.rows.values()].find(
      (row) => row.environment === environment && row.taxIdBlindIndex === blindIndex,
    );
  }

  async findById(environment: Environment, id: string) {
    const row = this.rows.get(id);
    return row?.environment === environment ? row : undefined;
  }

  async taxIdEnvelope(environment: Environment, id: string) {
    const envelope = this.envelopes.get(id);
    if (!envelope || (await this.findById(environment, id)) === undefined) return undefined;
    return { ...envelope, version: 1 };
  }

  async create(input: Parameters<HolderRepository['create']>[0]) {
    const record: HolderRecord = { ...input.record, createdAt: new Date() };
    this.rows.set(record.id, record);
    this.envelopes.set(record.id, input.taxIdEnvelope);
    return record;
  }
}

export class MemoryAccountRepository implements AccountRepository {
  readonly rows = new Map<string, AccountRecord>();
  readonly statusHistory: Array<{ accountId: string; from: AccountStatus; to: AccountStatus }> = [];

  async findById(environment: Environment, id: string) {
    const row = this.rows.get(id);
    return row?.environment === environment ? row : undefined;
  }

  async findByExternalId(environment: Environment, externalId: string) {
    return [...this.rows.values()].find(
      (row) => row.environment === environment && row.externalId === externalId,
    );
  }

  async findByProviderAccountId(
    environment: Environment,
    provider: string,
    providerAccountId: string,
  ) {
    return [...this.rows.values()].find(
      (row) =>
        row.environment === environment &&
        row.provider === provider &&
        row.providerAccountId === providerAccountId,
    );
  }

  async list(filter: ListAccountsFilter) {
    const all = [...this.rows.values()]
      .filter((row) => row.environment === filter.environment)
      .filter((row) => !filter.connectionId || row.providerConnectionId === filter.connectionId)
      .filter((row) => !filter.status || row.status === filter.status)
      .filter((row) => !filter.externalId || row.externalId === filter.externalId)
      // Ordem descendente por id: ULID e ordenavel no tempo, entao ordenar por
      // id e ordenar por criacao sem precisar de indice adicional.
      .sort((a, b) => b.id.localeCompare(a.id));

    const start = filter.cursor ? all.findIndex((row) => row.id === filter.cursor) + 1 : 0;
    const page = all.slice(start, start + filter.limit);
    const nextCursor = start + filter.limit < all.length ? page.at(-1)?.id : undefined;
    return { data: page, nextCursor };
  }

  async create(record: AccountRecord) {
    this.rows.set(record.id, { ...record });
    return record;
  }

  async attachLedgerAccounts(input: Parameters<AccountRepository['attachLedgerAccounts']>[0]) {
    const row = this.rows.get(input.accountId);
    if (!row) throw new Error(`Conta ${input.accountId} nao encontrada`);
    row.ledgerAvailableAccountId = input.availableId;
    row.ledgerBlockedAccountId = input.blockedId;
    row.updatedAt = new Date();
    return row;
  }

  async attachProviderAccount(input: Parameters<AccountRepository['attachProviderAccount']>[0]) {
    const row = this.rows.get(input.accountId);
    if (!row) throw new Error(`Conta ${input.accountId} nao encontrada`);

    Object.assign(row, {
      providerAccountId: input.providerAccountId,
      status: input.status,
      ispb: input.bank?.ispb ?? row.ispb,
      branch: input.bank?.branch ?? row.branch,
      number: input.bank?.number ?? row.number,
      checkDigit: input.bank?.checkDigit ?? row.checkDigit,
      openedAt: input.openedAt ?? row.openedAt,
      updatedAt: new Date(),
    });
    return row;
  }

  async applyStatusChange(input: Parameters<AccountRepository['applyStatusChange']>[0]) {
    const row = this.rows.get(input.accountId);
    if (!row || row.environment !== input.environment) {
      return { applied: false, reason: 'not_found' as const };
    }

    // Mesma decisao que a versao Prisma toma sob `SELECT ... FOR UPDATE`. Aqui
    // nao ha concorrencia real, mas manter a logica no mesmo lugar e o que
    // impede as duas implementacoes de divergirem.
    const decision = decideMonotonic({
      current: row.status,
      incoming: input.toStatus,
      ranks: ACCOUNT_STATUS_RANKS,
      occurredAt: input.occurredAt,
      lastEventAt: row.lastEventAt,
    });
    if (!decision.apply) {
      return { applied: false, reason: decision.reason, currentStatus: row.status };
    }

    const legal = checkTransition(ACCOUNT_STATUS_TRANSITIONS, row.status, input.toStatus);
    if (!legal.allowed) {
      return {
        applied: false,
        reason: 'illegal_transition' as const,
        currentStatus: row.status,
      };
    }

    const from = row.status;
    row.status = input.toStatus;
    row.statusReasonCode = input.reasonCode ?? row.statusReasonCode;
    row.statusReasonMessage = input.reasonMessage ?? row.statusReasonMessage;
    row.statusChangedAt = input.occurredAt;
    row.lastEventAt = input.occurredAt;
    row.updatedAt = input.occurredAt;
    if (input.toStatus === AccountStatus.CLOSED) row.closedAt = input.occurredAt;

    this.statusHistory.push({ accountId: row.id, from, to: input.toStatus });
    await input.withinTransaction?.(row.id);

    return { applied: true, record: row };
  }
}

export class MemoryOnboardingRepository implements OnboardingRepository {
  readonly rows = new Map<string, OnboardingRecord>();

  async findById(environment: Environment, id: string) {
    const row = this.rows.get(id);
    return row?.environment === environment ? row : undefined;
  }

  async findByAccountId(environment: Environment, accountId: string) {
    return [...this.rows.values()].find(
      (row) => row.environment === environment && row.accountId === accountId,
    );
  }

  async findByProviderCaseId(environment: Environment, provider: string, providerCaseId: string) {
    return [...this.rows.values()].find(
      (row) =>
        row.environment === environment &&
        row.provider === provider &&
        row.providerCaseId === providerCaseId,
    );
  }

  async create(record: OnboardingRecord) {
    this.rows.set(record.id, { ...record, requirements: [...record.requirements] });
    return record;
  }

  async applyStatusChange(input: Parameters<OnboardingRepository['applyStatusChange']>[0]) {
    const row = this.rows.get(input.caseId);
    if (!row || row.environment !== input.environment) {
      return { applied: false, reason: 'not_found' as const };
    }

    const decision = decideMonotonic({
      current: row.status,
      incoming: input.toStatus,
      ranks: ONBOARDING_STATUS_RANKS,
      occurredAt: input.occurredAt,
      lastEventAt: row.lastEventAt,
    });
    if (!decision.apply) {
      return { applied: false, reason: decision.reason, currentStatus: row.status };
    }

    const legal = checkTransition(ONBOARDING_STATUS_TRANSITIONS, row.status, input.toStatus);
    if (!legal.allowed) {
      return {
        applied: false,
        reason: 'illegal_transition' as const,
        currentStatus: row.status,
      };
    }

    row.status = input.toStatus;
    row.rejectionCode = input.rejectionCode ?? row.rejectionCode;
    row.rejectionMessage = input.rejectionMessage ?? row.rejectionMessage;
    row.providerRejectionCode = input.providerRejectionCode ?? row.providerRejectionCode;
    row.lastEventAt = input.occurredAt;
    row.updatedAt = input.occurredAt;
    if (
      input.toStatus === OnboardingStatus.APPROVED ||
      input.toStatus === OnboardingStatus.REJECTED
    ) {
      row.decidedAt = input.occurredAt;
    }

    if (input.requirements) {
      // Set-diff contra o conjunto COMPLETO que o provedor mandou: o que sumiu
      // da lista foi cumprido. Tratar a lista como delta faria a pendencia
      // ficar aberta para sempre.
      const pending = new Set(input.requirements.map((requirement) => requirement.code));

      for (const requirement of row.requirements) {
        if (!pending.has(requirement.code) && requirement.status === RequirementStatus.PENDING) {
          requirement.status = RequirementStatus.ACCEPTED;
        }
      }

      for (const requirement of input.requirements) {
        if (row.requirements.some((existing) => existing.code === requirement.code)) continue;
        row.requirements.push({
          id: newId('requirement'),
          caseId: row.id,
          code: requirement.code,
          status: RequirementStatus.PENDING,
          label: requirement.label,
          attempts: 0,
        });
      }
    }

    await input.withinTransaction?.(row.id);
    return { applied: true, record: row };
  }
}

export class MemoryOutboxRepository implements OutboxRepository {
  readonly rows: Array<OutboxDraft & { sequence: number }> = [];

  async append(draft: OutboxDraft) {
    this.rows.push({ ...draft, sequence: this.rows.length + 1 });
  }

  forSubject(subjectId: string) {
    return this.rows.filter((row) => row.subjectId === subjectId);
  }
}

export class MemoryAuditRepository implements AuditRepository {
  readonly rows: AuditDraft[] = [];

  async record(draft: AuditDraft) {
    this.rows.push(draft);
  }

  forResource(resourceId: string) {
    return this.rows.filter((row) => row.resourceId === resourceId);
  }
}

export class MemoryInboundEventRepository implements InboundEventRepository {
  readonly rows = new Map<string, InboundEventRecord>();

  async claim(record: InboundEventRecord) {
    const existing = [...this.rows.values()].find(
      (row) => row.connectionId === record.connectionId && row.dedupeKey === record.dedupeKey,
    );
    if (existing) return { inserted: false, record: existing };

    this.rows.set(record.id, { ...record });
    return { inserted: true, record };
  }

  async findById(id: string) {
    return this.rows.get(id);
  }

  async markProcessing(id: string) {
    const row = this.rows.get(id);
    if (!row || (row.status !== 'RECEIVED' && row.status !== 'FAILED')) return false;
    row.status = 'PROCESSING';
    row.attempts += 1;
    return true;
  }

  async markProcessed(id: string, at: Date) {
    const row = this.rows.get(id);
    if (row) Object.assign(row, { status: 'PROCESSED', processedAt: at });
  }

  async markDiscarded(id: string, reason: string) {
    const row = this.rows.get(id);
    if (row) Object.assign(row, { status: 'DISCARDED', lastError: reason });
  }

  async markFailed(id: string, error: string, deadLetter: boolean) {
    const row = this.rows.get(id);
    if (row)
      Object.assign(row, { status: deadLetter ? 'DEAD_LETTER' : 'FAILED', lastError: error });
  }

  async findStale(olderThan: Date, limit: number) {
    return [...this.rows.values()]
      .filter((row) => row.status === 'RECEIVED' && row.receivedAt <= olderThan)
      .slice(0, limit);
  }
}
