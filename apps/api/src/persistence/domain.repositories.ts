import { AsyncLocalStorage } from 'node:async_hooks';

import type { Prisma } from '@baasconn/db';
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
import { Injectable } from '@nestjs/common';

import type {
  AccountRecord,
  AccountRepository,
  HolderRecord,
  HolderRepository,
  ListAccountsFilter,
  OnboardingRecord,
  OnboardingRepository,
  StatusChangeResult,
} from '../accounts/accounts.types.js';
import type {
  AuditDraft,
  AuditRepository,
  OutboxDraft,
  OutboxRepository,
} from '../events/outbox.types.js';
import type { InboundEventRecord, InboundEventRepository } from '../webhooks/webhooks.types.js';

import { PrismaService } from './prisma.service.js';

/** Transacao do Prisma, para o callback `withinTransaction` participar dela. */
type Tx = Prisma.TransactionClient;

@Injectable()
export class PrismaHolderRepository implements HolderRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByTaxIdBlindIndex(environment: Environment, blindIndex: string) {
    const row = await this.prisma.client.accountHolder.findFirst({
      where: { environment, taxIdBlindIndex: blindIndex },
    });
    return row ? toHolder(row) : undefined;
  }

  async findById(environment: Environment, id: string) {
    const row = await this.prisma.client.accountHolder.findFirst({ where: { environment, id } });
    return row ? toHolder(row) : undefined;
  }

  async taxIdEnvelope(environment: Environment, id: string) {
    const row = await this.prisma.client.accountHolder.findFirst({
      where: { environment, id },
      select: {
        taxIdCiphertext: true,
        taxIdIv: true,
        taxIdTag: true,
        taxIdWrappedKey: true,
        taxIdKeyId: true,
      },
    });
    if (!row) return undefined;

    return {
      ciphertext: Buffer.from(row.taxIdCiphertext),
      iv: Buffer.from(row.taxIdIv),
      authTag: Buffer.from(row.taxIdTag),
      wrappedKey: Buffer.from(row.taxIdWrappedKey),
      keyId: row.taxIdKeyId,
      version: 1,
    };
  }

  async create(input: Parameters<HolderRepository['create']>[0]) {
    const row = await this.prisma.client.accountHolder.create({
      data: {
        id: input.record.id,
        environment: input.record.environment,
        type: input.record.type,
        taxIdType: input.record.taxIdType,
        taxIdCiphertext: new Uint8Array(input.taxIdEnvelope.ciphertext),
        taxIdIv: new Uint8Array(input.taxIdEnvelope.iv),
        taxIdTag: new Uint8Array(input.taxIdEnvelope.authTag),
        taxIdWrappedKey: new Uint8Array(input.taxIdEnvelope.wrappedKey),
        taxIdKeyId: input.taxIdEnvelope.keyId,
        taxIdBlindIndex: input.record.taxIdBlindIndex,
        emailBlindIndex: input.emailBlindIndex,
        taxIdLast4: input.record.taxIdLast4,
        legalName: input.record.legalName,
        email: input.record.email,
        phoneCountryCode: input.phone.countryCode,
        phoneAreaCode: input.phone.areaCode,
        phoneNumber: input.phone.number,
        externalId: input.record.externalId ?? null,
      },
    });
    return toHolder(row);
  }
}

@Injectable()
export class PrismaAccountRepository implements AccountRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(environment: Environment, id: string) {
    const row = await this.prisma.client.account.findFirst({ where: { environment, id } });
    return row ? toAccount(row) : undefined;
  }

  async findByExternalId(environment: Environment, externalId: string) {
    const row = await this.prisma.client.account.findFirst({ where: { environment, externalId } });
    return row ? toAccount(row) : undefined;
  }

  async findByProviderAccountId(
    environment: Environment,
    provider: string,
    providerAccountId: string,
  ) {
    const row = await this.prisma.client.account.findFirst({
      where: { environment, provider: provider as never, providerAccountId },
    });
    return row ? toAccount(row) : undefined;
  }

  async list(filter: ListAccountsFilter) {
    // Cursor por id: ULID e ordenavel no tempo, entao paginar por id e paginar
    // por criacao sem indice extra — e, ao contrario de offset, nao produz
    // duplicata nem buraco quando chegam linhas novas durante a paginacao.
    const rows = await this.prisma.client.account.findMany({
      where: {
        environment: filter.environment,
        status: filter.status,
        externalId: filter.externalId,
        holder: filter.holderType ? { type: filter.holderType } : undefined,
        id: filter.cursor ? { lt: filter.cursor } : undefined,
      },
      orderBy: { id: 'desc' },
      take: filter.limit + 1,
    });

    const hasMore = rows.length > filter.limit;
    const page = hasMore ? rows.slice(0, filter.limit) : rows;
    return {
      data: page.map(toAccount),
      nextCursor: hasMore ? page.at(-1)?.id : undefined,
    };
  }

  async create(record: AccountRecord) {
    const row = await this.prisma.client.account.create({
      data: {
        id: record.id,
        environment: record.environment,
        holderId: record.holderId,
        provider: record.provider as never,
        providerConnectionId: record.providerConnectionId,
        externalId: record.externalId ?? null,
        status: record.status,
        kind: record.kind,
        currency: record.currency,
        metadata: record.metadata as Prisma.InputJsonValue,
      },
    });
    return toAccount(row);
  }

  async attachLedgerAccounts(input: Parameters<AccountRepository['attachLedgerAccounts']>[0]) {
    const row = await this.prisma.client.account.update({
      where: { id: input.accountId },
      data: {
        ledgerAvailableAccountId: input.availableId,
        ledgerBlockedAccountId: input.blockedId,
      },
    });
    return toAccount(row);
  }

  async attachProviderAccount(input: Parameters<AccountRepository['attachProviderAccount']>[0]) {
    const row = await this.prisma.client.account.update({
      where: { id: input.accountId },
      data: {
        providerAccountId: input.providerAccountId,
        status: input.status,
        ispb: input.bank?.ispb,
        branch: input.bank?.branch,
        number: input.bank?.number,
        checkDigit: input.bank?.checkDigit,
        openedAt: input.openedAt,
      },
    });
    return toAccount(row);
  }

  /**
   * Muda o status sob lock de linha.
   *
   * `SELECT ... FOR UPDATE` via `$queryRaw`, porque o Prisma nao expoe lock
   * pessimista na API fluente. O lock e mantido do SELECT ao COMMIT: e ele que
   * torna a decisao segura contra uma escrita concorrente da API.
   *
   * NAO existe coluna `status_rank`. Os ranks vivem na taxonomia, e uma coluna
   * desnormalizada exigiria migracao a cada status novo — o custo aqui e um
   * round-trip a mais, pago fora do caminho de requisicao.
   */
  async applyStatusChange(
    input: Parameters<AccountRepository['applyStatusChange']>[0],
  ): Promise<StatusChangeResult<AccountRecord>> {
    return this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '3s'`);

      const locked = await tx.$queryRaw<
        Array<{ id: string; status: AccountStatus; last_event_at: Date | null }>
      >`SELECT id, status, last_event_at FROM account
        WHERE id = ${input.accountId} AND environment = ${input.environment}::"Environment"
        FOR UPDATE`;

      const current = locked[0];
      if (!current) return { applied: false, reason: 'not_found' as const };

      const decision = decideMonotonic({
        current: current.status,
        incoming: input.toStatus,
        ranks: ACCOUNT_STATUS_RANKS,
        occurredAt: input.occurredAt,
        lastEventAt: current.last_event_at,
      });
      if (!decision.apply) {
        return { applied: false, reason: decision.reason, currentStatus: current.status };
      }

      const legal = checkTransition(ACCOUNT_STATUS_TRANSITIONS, current.status, input.toStatus);
      if (!legal.allowed) {
        return {
          applied: false,
          reason: 'illegal_transition' as const,
          currentStatus: current.status,
        };
      }

      const row = await tx.account.update({
        where: { id: input.accountId },
        data: {
          status: input.toStatus,
          statusReasonCode: input.reasonCode,
          statusReasonMessage: input.reasonMessage,
          statusChangedAt: input.occurredAt,
          lastEventAt: input.occurredAt,
          closedAt: input.toStatus === AccountStatus.CLOSED ? input.occurredAt : undefined,
        },
      });

      await tx.accountStatusChange.create({
        data: {
          id: newId('event'),
          accountId: input.accountId,
          fromStatus: current.status,
          toStatus: input.toStatus,
          reasonCode: input.reasonCode,
          reasonMessage: input.reasonMessage,
          source: input.source as never,
          providerEventId: input.providerEventId,
          occurredAt: input.occurredAt,
        },
      });

      // O outbox e a auditoria entram AQUI, na mesma transacao: se um deles
      // falhar, a mudanca de status volta atras. E exatamente para isso que o
      // outbox existe.
      await withTransactionalPorts(tx, () => input.withinTransaction?.(input.accountId));

      return { applied: true, record: toAccount(row) };
    });
  }
}

@Injectable()
export class PrismaOnboardingRepository implements OnboardingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(environment: Environment, id: string) {
    const row = await this.prisma.client.onboardingCase.findFirst({
      where: { environment, id },
      include: { requirements: true },
    });
    return row ? toOnboarding(row) : undefined;
  }

  async findByAccountId(environment: Environment, accountId: string) {
    const row = await this.prisma.client.onboardingCase.findFirst({
      where: { environment, accountId },
      include: { requirements: true },
      orderBy: { createdAt: 'desc' },
    });
    return row ? toOnboarding(row) : undefined;
  }

  async findByProviderCaseId(environment: Environment, provider: string, providerCaseId: string) {
    const row = await this.prisma.client.onboardingCase.findFirst({
      where: { environment, provider: provider as never, providerCaseId },
      include: { requirements: true },
    });
    return row ? toOnboarding(row) : undefined;
  }

  async create(record: OnboardingRecord) {
    const row = await this.prisma.client.onboardingCase.create({
      data: {
        id: record.id,
        environment: record.environment,
        holderId: record.holderId,
        accountId: record.accountId,
        provider: record.provider as never,
        providerCaseId: record.providerCaseId,
        type: record.type,
        status: record.status,
        rejectionCode: record.rejectionCode as never,
        rejectionMessage: record.rejectionMessage,
        providerRejectionCode: record.providerRejectionCode,
        submittedAt: record.submittedAt,
        requirements: {
          create: record.requirements.map((requirement) => ({
            id: requirement.id,
            code: requirement.code,
            status: requirement.status,
            label: requirement.label,
          })),
        },
      },
      include: { requirements: true },
    });
    return toOnboarding(row);
  }

  async applyStatusChange(
    input: Parameters<OnboardingRepository['applyStatusChange']>[0],
  ): Promise<StatusChangeResult<OnboardingRecord>> {
    return this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '3s'`);

      const locked = await tx.$queryRaw<
        Array<{ id: string; status: OnboardingStatus; last_event_at: Date | null }>
      >`SELECT id, status, last_event_at FROM onboarding_case
        WHERE id = ${input.caseId} AND environment = ${input.environment}::"Environment"
        FOR UPDATE`;

      const current = locked[0];
      if (!current) return { applied: false, reason: 'not_found' as const };

      const decision = decideMonotonic({
        current: current.status,
        incoming: input.toStatus,
        ranks: ONBOARDING_STATUS_RANKS,
        occurredAt: input.occurredAt,
        lastEventAt: current.last_event_at,
      });
      if (!decision.apply) {
        return { applied: false, reason: decision.reason, currentStatus: current.status };
      }

      const legal = checkTransition(ONBOARDING_STATUS_TRANSITIONS, current.status, input.toStatus);
      if (!legal.allowed) {
        return {
          applied: false,
          reason: 'illegal_transition' as const,
          currentStatus: current.status,
        };
      }

      const decided =
        input.toStatus === OnboardingStatus.APPROVED ||
        input.toStatus === OnboardingStatus.REJECTED;

      await tx.onboardingCase.update({
        where: { id: input.caseId },
        data: {
          status: input.toStatus,
          rejectionCode: input.rejectionCode as never,
          rejectionMessage: input.rejectionMessage,
          providerRejectionCode: input.providerRejectionCode,
          lastEventAt: input.occurredAt,
          decidedAt: decided ? input.occurredAt : undefined,
        },
      });

      if (input.requirements) await this.syncRequirements(tx, input.caseId, input.requirements);
      await withTransactionalPorts(tx, () => input.withinTransaction?.(input.caseId));

      const row = await tx.onboardingCase.findUniqueOrThrow({
        where: { id: input.caseId },
        include: { requirements: true },
      });
      return { applied: true, record: toOnboarding(row) };
    });
  }

  /**
   * Reconcilia as pendencias contra o conjunto COMPLETO do provedor.
   *
   * O que sumiu da lista foi cumprido. Tratar a lista como delta faria a
   * pendencia ficar aberta para sempre — a falha classica de integracao de KYC,
   * em que o cliente ve "envie sua selfie" depois de ja ter enviado.
   */
  private async syncRequirements(
    tx: Tx,
    caseId: string,
    requirements: NonNullable<
      Parameters<OnboardingRepository['applyStatusChange']>[0]['requirements']
    >,
  ): Promise<void> {
    const pending = requirements.map((requirement) => requirement.code);

    await tx.onboardingRequirement.updateMany({
      where: { caseId, status: RequirementStatus.PENDING, code: { notIn: pending } },
      data: { status: RequirementStatus.ACCEPTED },
    });

    for (const requirement of requirements) {
      await tx.onboardingRequirement.upsert({
        where: { id: `${caseId}:${requirement.code}` },
        create: {
          id: newId('requirement'),
          caseId,
          code: requirement.code,
          status: RequirementStatus.PENDING,
          label: requirement.label,
        },
        update: {},
      });
    }
  }
}

@Injectable()
export class PrismaOutboxRepository implements OutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  async append(draft: OutboxDraft) {
    await client(this.prisma).outboxEvent.create({
      data: {
        id: newId('event'),
        environment: draft.environment,
        type: draft.type,
        dataVersion: 1,
        provider: draft.provider as never,
        connectionId: draft.connectionId,
        subjectKind: draft.subjectKind,
        subjectId: draft.subjectId,
        payload: draft.payload as Prisma.InputJsonValue,
        previous: (draft.previous ?? null) as Prisma.InputJsonValue,
        occurredAt: draft.occurredAt,
      },
    });
  }
}

@Injectable()
export class PrismaAuditRepository implements AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Insere na trilha.
   *
   * Somente INSERT: a cadeia de hash e um trigger `BEFORE INSERT` e o papel da
   * aplicacao nao tem UPDATE nem DELETE na tabela. Nao existe metodo para
   * alterar uma linha porque nao existe permissao para isso.
   */
  async record(draft: AuditDraft) {
    await client(this.prisma).auditLog.create({
      data: {
        id: newId('audit'),
        environment: draft.environment,
        occurredAt: draft.occurredAt,
        actorType: draft.actorType,
        actorId: draft.actorId,
        actorLabel: draft.actorLabel,
        actorIp: draft.actorIp,
        action: draft.action,
        outcome: draft.outcome,
        errorCode: draft.errorCode,
        resourceType: draft.resourceType,
        resourceId: draft.resourceId,
        connectionId: draft.connectionId,
        provider: draft.provider as never,
        before: (draft.before ?? null) as Prisma.InputJsonValue,
        after: (draft.after ?? null) as Prisma.InputJsonValue,
        changedFields: draft.changedFields ?? [],
        requestId: draft.requestId,
        operationId: draft.operationId,
        rowHash: new Uint8Array(0),
      },
    });
  }
}

@Injectable()
export class PrismaInboundEventRepository implements InboundEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  async claim(record: InboundEventRecord) {
    const inserted = await this.prisma.client.inboundWebhookEvent.createMany({
      data: [
        {
          id: record.id,
          environment: record.environment,
          connectionId: record.connectionId,
          provider: record.provider as never,
          dedupeKey: record.dedupeKey,
          providerEventId: record.providerEventId,
          eventTypeRaw: record.eventTypeRaw,
          occurredAt: record.occurredAt,
          receivedAt: record.receivedAt,
          headers: record.headers as Prisma.InputJsonValue,
          payload: JSON.parse(record.payload.toString('utf8') || 'null') as Prisma.InputJsonValue,
          rawSha256: record.rawSha256,
          signatureValid: record.signatureValid,
          status: record.status,
        },
      ],
      skipDuplicates: true,
    });

    if (inserted.count === 1) return { inserted: true, record };

    const existing = await this.prisma.client.inboundWebhookEvent.findUniqueOrThrow({
      where: {
        connectionId_dedupeKey: {
          connectionId: record.connectionId,
          dedupeKey: record.dedupeKey,
        },
      },
    });
    return { inserted: false, record: toInboundEvent(existing) };
  }

  async findById(id: string) {
    const row = await this.prisma.client.inboundWebhookEvent.findUnique({ where: { id } });
    return row ? toInboundEvent(row) : undefined;
  }

  /** Compare-and-set: dois consumidores nao processam o mesmo evento. */
  async markProcessing(id: string) {
    const result = await this.prisma.client.inboundWebhookEvent.updateMany({
      where: { id, status: { in: ['RECEIVED', 'FAILED'] } },
      data: { status: 'PROCESSING', attempts: { increment: 1 } },
    });
    return result.count === 1;
  }

  async markProcessed(id: string, at: Date) {
    await this.prisma.client.inboundWebhookEvent.update({
      where: { id },
      data: { status: 'PROCESSED', processedAt: at },
    });
  }

  async markDiscarded(id: string, reason: string) {
    await this.prisma.client.inboundWebhookEvent.update({
      where: { id },
      data: { status: 'DISCARDED', lastError: reason },
    });
  }

  async markFailed(id: string, error: string, deadLetter: boolean) {
    await this.prisma.client.inboundWebhookEvent.update({
      where: { id },
      data: { status: deadLetter ? 'DEAD_LETTER' : 'FAILED', lastError: error.slice(0, 1000) },
    });
  }

  async findStale(olderThan: Date, limit: number) {
    const rows = await this.prisma.client.inboundWebhookEvent.findMany({
      where: { status: 'RECEIVED', receivedAt: { lte: olderThan } },
      take: limit,
    });
    return rows.map(toInboundEvent);
  }
}

/**
 * Transacao ambiente da requisicao em curso.
 *
 * `AsyncLocalStorage`, e nao uma variavel de modulo: duas chamadas
 * concorrentes de `applyStatusChange` sobrescreveriam uma a transacao da
 * outra, e o outbox de uma conta seria gravado dentro da transacao de outra —
 * um bug que so aparece sob carga e some quando voce vai depurar.
 */
const transactionStorage = new AsyncLocalStorage<Tx>();

/**
 * Executa o callback dentro da transacao aberta.
 *
 * O outbox e a auditoria recebem o `PrismaService` por injecao e usam o
 * cliente normal. Para participarem da MESMA transacao, o cliente e resolvido
 * pelo contexto — e o preco de manter os dois como portas injetaveis, em vez
 * de arrastar `tx` por toda assinatura do dominio.
 */
export async function withTransactionalPorts(tx: Tx, fn: () => Promise<void> | undefined): Promise<void> {
  await transactionStorage.run(tx, async () => {
    await fn();
  });
}

function client(prisma: PrismaService): Tx {
  return transactionStorage.getStore() ?? (prisma.client as unknown as Tx);
}

function toHolder(row: {
  id: string;
  environment: string;
  type: string;
  taxIdType: string;
  taxIdBlindIndex: string;
  taxIdLast4: string;
  legalName: string;
  email: string;
  externalId: string | null;
  createdAt: Date;
}): HolderRecord {
  return {
    id: row.id,
    environment: row.environment as Environment,
    type: row.type as HolderRecord['type'],
    taxIdType: row.taxIdType as HolderRecord['taxIdType'],
    taxIdBlindIndex: row.taxIdBlindIndex,
    taxIdLast4: row.taxIdLast4,
    legalName: row.legalName,
    email: row.email,
    externalId: row.externalId,
    createdAt: row.createdAt,
  };
}

function toAccount(row: Record<string, unknown>): AccountRecord {
  return {
    id: row.id as string,
    environment: row.environment as Environment,
    holderId: row.holderId as string,
    provider: row.provider as string,
    providerConnectionId: row.providerConnectionId as string,
    providerAccountId: (row.providerAccountId as string | null) ?? null,
    externalId: (row.externalId as string | null) ?? null,
    status: row.status as AccountStatus,
    statusReasonCode: (row.statusReasonCode as string | null) ?? null,
    statusReasonMessage: (row.statusReasonMessage as string | null) ?? null,
    statusChangedAt: (row.statusChangedAt as Date | null) ?? null,
    lastEventAt: (row.lastEventAt as Date | null) ?? null,
    kind: row.kind as AccountRecord['kind'],
    currency: row.currency as string,
    ledgerAvailableAccountId: (row.ledgerAvailableAccountId as string | null) ?? null,
    ledgerBlockedAccountId: (row.ledgerBlockedAccountId as string | null) ?? null,
    ispb: (row.ispb as string | null) ?? null,
    branch: (row.branch as string | null) ?? null,
    number: (row.number as string | null) ?? null,
    checkDigit: (row.checkDigit as string | null) ?? null,
    openedAt: (row.openedAt as Date | null) ?? null,
    closedAt: (row.closedAt as Date | null) ?? null,
    metadata: (row.metadata as Record<string, string>) ?? {},
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}

function toOnboarding(row: Record<string, unknown>): OnboardingRecord {
  const requirements = (row.requirements as Array<Record<string, unknown>>) ?? [];
  return {
    id: row.id as string,
    environment: row.environment as Environment,
    holderId: row.holderId as string,
    accountId: (row.accountId as string | null) ?? null,
    provider: row.provider as string,
    providerCaseId: (row.providerCaseId as string | null) ?? null,
    type: row.type as OnboardingRecord['type'],
    status: row.status as OnboardingStatus,
    lastEventAt: (row.lastEventAt as Date | null) ?? null,
    rejectionCode: (row.rejectionCode as string | null) ?? null,
    rejectionMessage: (row.rejectionMessage as string | null) ?? null,
    providerRejectionCode: (row.providerRejectionCode as string | null) ?? null,
    submittedAt: (row.submittedAt as Date | null) ?? null,
    decidedAt: (row.decidedAt as Date | null) ?? null,
    requirements: requirements.map((requirement) => ({
      id: requirement.id as string,
      caseId: requirement.caseId as string,
      code: requirement.code as OnboardingRecord['requirements'][number]['code'],
      status: requirement.status as RequirementStatus,
      label: requirement.label as string,
      documentId: (requirement.documentId as string | null) ?? null,
      attempts: (requirement.attempts as number) ?? 0,
    })),
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}

function toInboundEvent(row: Record<string, unknown>): InboundEventRecord {
  return {
    id: row.id as string,
    environment: row.environment as Environment,
    connectionId: row.connectionId as string,
    provider: row.provider as string,
    dedupeKey: row.dedupeKey as string,
    providerEventId: (row.providerEventId as string | null) ?? null,
    eventTypeRaw: (row.eventTypeRaw as string | null) ?? null,
    occurredAt: (row.occurredAt as Date | null) ?? null,
    receivedAt: row.receivedAt as Date,
    headers: (row.headers as Record<string, string>) ?? {},
    payload: Buffer.from(JSON.stringify(row.payload ?? null), 'utf8'),
    rawSha256: row.rawSha256 as string,
    signatureValid: row.signatureValid as boolean,
    status: row.status as InboundEventRecord['status'],
    attempts: (row.attempts as number) ?? 0,
    lastError: (row.lastError as string | null) ?? null,
    processedAt: (row.processedAt as Date | null) ?? null,
  };
}
