import type { Prisma } from '@baasconn/db';
import {
  PIX_CHARGE_STATUS_TRANSITIONS,
  PixChargeStatus,
  TRANSACTION_STATUS_RANKS,
  TRANSACTION_STATUS_TRANSITIONS,
  TransactionStatus,
  checkTransition,
  decideMonotonic,
  newId,
  type Environment,
} from '@baasconn/taxonomy';
import { Injectable } from '@nestjs/common';

import type { StatusChangeResult } from '../accounts/accounts.types.js';
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
} from '../pix/pix.types.js';

import { withTransactionalPorts } from './domain.repositories.js';
import { PrismaService } from './prisma.service.js';

@Injectable()
export class PrismaTransactionRepository implements TransactionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(environment: Environment, id: string) {
    const row = await this.prisma.client.transaction.findFirst({
      where: { environment, id },
      include: { pix: true },
    });
    return row ? toTransaction(row) : undefined;
  }

  async findByProviderTransactionId(
    environment: Environment,
    provider: string,
    providerTransactionId: string,
  ) {
    const row = await this.prisma.client.transaction.findFirst({
      where: { environment, provider: provider as never, providerTransactionId },
      include: { pix: true },
    });
    return row ? toTransaction(row) : undefined;
  }

  /**
   * Busca pelo E2EID.
   *
   * E a chave de idempotencia de ultimo recurso para webhook: quando o
   * provedor manda um evento sem o id da transacao dele, ou quando um PIX de
   * entrada chega sem nenhuma referencia nossa, o E2EID e o unico
   * identificador globalmente unico disponivel.
   */
  async findByEndToEndId(environment: Environment, endToEndId: string) {
    const row = await this.prisma.client.transaction.findFirst({
      where: { environment, pix: { endToEndId } },
      include: { pix: true },
    });
    return row ? toTransaction(row) : undefined;
  }

  async findByIdempotencyKey(environment: Environment, idempotencyKey: string) {
    const row = await this.prisma.client.transaction.findFirst({
      where: { environment, idempotencyKey },
      include: { pix: true },
    });
    return row ? toTransaction(row) : undefined;
  }

  async create(record: TransactionRecord) {
    const row = await this.prisma.client.transaction.create({
      data: {
        id: record.id,
        environment: record.environment,
        accountId: record.accountId,
        chargeId: record.chargeId ?? null,
        parentTransactionId: record.parentTransactionId ?? null,
        type: record.type,
        direction: record.direction,
        status: record.status,
        lastEventAt: record.lastEventAt ?? null,
        amountCents: record.amountCents,
        feeCents: record.feeCents,
        netAmountCents: record.netAmountCents,
        refundedAmountCents: record.refundedAmountCents,
        currency: record.currency,
        description: record.description ?? null,
        provider: record.provider as never,
        providerConnectionId: record.providerConnectionId,
        providerTransactionId: record.providerTransactionId ?? null,
        externalId: record.externalId ?? null,
        idempotencyKey: record.idempotencyKey ?? null,
        operationId: record.operationId ?? null,
        effectiveDate: new Date(`${record.effectiveDate}T00:00:00.000Z`),
        requestedAt: record.requestedAt,
        ledgerPendingTransactionId: record.ledgerPendingTransactionId ?? null,
        ledgerPostedTransactionId: record.ledgerPostedTransactionId ?? null,
        metadata: record.metadata as Prisma.InputJsonValue,
        pix: record.pix
          ? {
              create: {
                environment: record.environment,
                endToEndId: record.pix.endToEndId ?? null,
                returnId: record.pix.returnId ?? null,
                originalEndToEndId: record.pix.originalEndToEndId ?? null,
                txid: record.pix.txid ?? null,
                initiationMethod: record.pix.initiationMethod,
                purpose: record.pix.purpose,
                keyType: record.pix.keyType ?? null,
                keyValue: record.pix.keyValue ?? null,
                counterpartyName: record.pix.counterparty?.name ?? null,
                counterpartyTaxIdIndex: record.pix.counterparty?.taxIdIndex ?? null,
                counterpartyTaxIdLast4: record.pix.counterparty?.taxIdLast4 ?? null,
                counterpartyIspb: record.pix.counterparty?.ispb ?? null,
                counterpartyBranch: record.pix.counterparty?.branch ?? null,
                counterpartyAccount: record.pix.counterparty?.accountNumber ?? null,
                remittanceInfo: record.pix.remittanceInfo ?? null,
                settlementAt: record.pix.settlementAt ?? null,
              },
            }
          : undefined,
      },
      include: { pix: true },
    });
    return toTransaction(row);
  }

  async list(filter: ListTransactionsFilter) {
    const rows = await this.prisma.client.transaction.findMany({
      where: {
        environment: filter.environment,
        accountId: filter.accountId,
        status: filter.status,
        direction: filter.direction,
        pix: filter.endToEndId ? { endToEndId: filter.endToEndId } : undefined,
        id: filter.cursor ? { lt: filter.cursor } : undefined,
      },
      include: { pix: true },
      orderBy: { id: 'desc' },
      take: filter.limit + 1,
    });

    const hasMore = rows.length > filter.limit;
    const page = hasMore ? rows.slice(0, filter.limit) : rows;
    return { data: page.map(toTransaction), nextCursor: hasMore ? page.at(-1)?.id : undefined };
  }

  /**
   * Extrato por keyset sobre `(effective_date desc, id desc)`.
   *
   * O indice `(account_id, effective_date desc, id desc)` existe exatamente
   * para isto. Offset foi rejeitado: sobre tabela que recebe insert constante
   * ele produz duplicata e buraco, e num extrato financeiro isso e bug de
   * correcao, nao de desempenho.
   */
  async statement(filter: StatementFilter) {
    const cursor = filter.cursor;

    const rows = await this.prisma.client.transaction.findMany({
      where: {
        environment: filter.environment,
        accountId: filter.accountId,
        status: { in: [...filter.statuses] },
        effectiveDate: {
          gte: new Date(`${filter.from}T00:00:00.000Z`),
          lte: new Date(`${filter.to}T00:00:00.000Z`),
        },
        ...(cursor
          ? {
              OR: [
                { effectiveDate: { lt: new Date(`${cursor.date}T00:00:00.000Z`) } },
                {
                  effectiveDate: new Date(`${cursor.date}T00:00:00.000Z`),
                  id: { lt: cursor.id },
                },
              ],
            }
          : {}),
      },
      include: { pix: true },
      orderBy: [{ effectiveDate: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
    });

    const hasMore = rows.length > filter.limit;
    const page = hasMore ? rows.slice(0, filter.limit) : rows;
    const last = page.at(-1);
    return {
      data: page.map(toTransaction),
      nextCursor:
        hasMore && last ? { date: toDateOnly(last.effectiveDate), id: last.id } : undefined,
    };
  }

  async applyStatusChange(
    input: Parameters<TransactionRepository['applyStatusChange']>[0],
  ): Promise<StatusChangeResult<TransactionRecord>> {
    return this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '3s'`);

      const locked = await tx.$queryRaw<
        Array<{ id: string; status: TransactionStatus; last_event_at: Date | null }>
      >`SELECT id, status, last_event_at FROM transaction
        WHERE id = ${input.transactionId} AND environment = ${input.environment}::"Environment"
        FOR UPDATE`;

      const current = locked[0];
      if (!current) return { applied: false, reason: 'not_found' as const };

      const decision = decideMonotonic({
        current: current.status,
        incoming: input.toStatus,
        ranks: TRANSACTION_STATUS_RANKS,
        occurredAt: input.occurredAt,
        lastEventAt: current.last_event_at,
      });
      if (!decision.apply) {
        return { applied: false, reason: decision.reason, currentStatus: current.status };
      }

      const legal = checkTransition(TRANSACTION_STATUS_TRANSITIONS, current.status, input.toStatus);
      if (!legal.allowed) {
        return {
          applied: false,
          reason: 'illegal_transition' as const,
          currentStatus: current.status,
        };
      }

      await tx.transaction.update({
        where: { id: input.transactionId },
        data: {
          status: input.toStatus,
          lastEventAt: input.occurredAt,
          failureCode: input.failureCode,
          providerFailureCode: input.providerFailureCode,
          failureMessage: input.failureMessage,
          settledAt: input.settledAt,
          failedAt: input.toStatus === TransactionStatus.FAILED ? input.occurredAt : undefined,
          processingAt:
            input.toStatus === TransactionStatus.PROCESSING ? input.occurredAt : undefined,
          ledgerPostedTransactionId: input.ledgerPostedTransactionId,
        },
      });

      if (input.endToEndId) {
        await tx.pixDetail.update({
          where: { transactionId: input.transactionId },
          data: { endToEndId: input.endToEndId, settlementAt: input.settledAt },
        });
      }

      await tx.transactionStatusChange.create({
        data: {
          id: newId('event'),
          transactionId: input.transactionId,
          fromStatus: current.status,
          toStatus: input.toStatus,
          reasonCode: input.failureCode,
          reasonMessage: input.failureMessage,
          source: input.source as never,
          providerEventId: input.providerEventId,
          occurredAt: input.occurredAt,
        },
      });

      await withTransactionalPorts(tx, () => input.withinTransaction?.(input.transactionId));

      const row = await tx.transaction.findUniqueOrThrow({
        where: { id: input.transactionId },
        include: { pix: true },
      });
      return { applied: true, record: toTransaction(row) };
    });
  }

  async attachProviderTransaction(
    input: Parameters<TransactionRepository['attachProviderTransaction']>[0],
  ) {
    const row = await this.prisma.client.transaction.update({
      where: { id: input.transactionId },
      data: {
        providerTransactionId: input.providerTransactionId,
        status: input.status,
        pix: input.endToEndId ? { update: { endToEndId: input.endToEndId } } : undefined,
      },
      include: { pix: true },
    });
    return toTransaction(row);
  }
}

@Injectable()
export class PrismaPixKeyRepository implements PixKeyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(environment: Environment, id: string) {
    const row = await this.prisma.client.pixKey.findFirst({ where: { environment, id } });
    return row ? toPixKey(row) : undefined;
  }

  async listByAccount(environment: Environment, accountId: string) {
    const rows = await this.prisma.client.pixKey.findMany({
      where: { environment, accountId },
      orderBy: { requestedAt: 'desc' },
    });
    return rows.map(toPixKey);
  }

  async findActiveByBlindIndex(environment: Environment, blindIndex: string) {
    const row = await this.prisma.client.pixKey.findFirst({
      where: { environment, valueBlindIndex: blindIndex, status: 'ACTIVE' },
    });
    return row ? toPixKey(row) : undefined;
  }

  async create(record: PixKeyRecord) {
    const row = await this.prisma.client.pixKey.create({
      data: {
        id: record.id,
        environment: record.environment,
        accountId: record.accountId,
        type: record.type,
        value: record.value,
        valueBlindIndex: record.valueBlindIndex,
        status: record.status,
        providerKeyId: record.providerKeyId ?? null,
        requestedAt: record.requestedAt,
        activatedAt: record.activatedAt ?? null,
      },
    });
    return toPixKey(row);
  }

  async markRemoved(environment: Environment, id: string, at: Date) {
    // `updateMany` com o ambiente no filtro: `update` por id sozinho alcancaria
    // uma linha do outro ambiente se o id vazasse de um lado para o outro.
    await this.prisma.client.pixKey.updateMany({
      where: { environment, id },
      data: { status: 'REMOVED', removedAt: at },
    });
  }
}

@Injectable()
export class PrismaPixChargeRepository implements PixChargeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByTxid(environment: Environment, txid: string) {
    const row = await this.prisma.client.pixCharge.findFirst({ where: { environment, txid } });
    return row ? toPixCharge(row) : undefined;
  }

  async listByAccount(environment: Environment, accountId: string, limit: number) {
    const rows = await this.prisma.client.pixCharge.findMany({
      where: { environment, accountId },
      orderBy: { id: 'desc' },
      take: limit,
    });
    return rows.map(toPixCharge);
  }

  async create(record: PixChargeRecord) {
    const row = await this.prisma.client.pixCharge.create({
      data: {
        id: record.id,
        environment: record.environment,
        accountId: record.accountId,
        pixKeyId: record.pixKeyId,
        kind: record.kind,
        txid: record.txid,
        status: record.status,
        revision: record.revision,
        amountCents: record.amountCents ?? null,
        amountIsChangeable: record.amountIsChangeable,
        currency: record.currency,
        expiresAt: record.expiresAt ?? null,
        emvPayload: record.emvPayload,
        provider: record.provider as never,
        providerChargeId: record.providerChargeId ?? null,
        externalId: record.externalId ?? null,
        paidAmountCents: record.paidAmountCents,
        metadata: record.metadata as Prisma.InputJsonValue,
      },
    });
    return toPixCharge(row);
  }

  /**
   * Muda o status da cobranca sob lock.
   *
   * Sem `decideMonotonic`: `PIX_CHARGE_STATUS_TRANSITIONS` ja e uma cadeia sem
   * volta (ACTIVE e o unico estado com saidas), entao a tabela de transicao
   * sozinha absorve reentrega e evento fora de ordem. O carimbo de tempo ainda
   * e checado, para um evento antigo nao sobrescrever um recente.
   */
  async applyStatusChange(
    input: Parameters<PixChargeRepository['applyStatusChange']>[0],
  ): Promise<StatusChangeResult<PixChargeRecord>> {
    return this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '3s'`);

      const locked = await tx.$queryRaw<
        Array<{ id: string; status: PixChargeStatus; last_event_at: Date | null }>
      >`SELECT id, status, last_event_at FROM pix_charge
        WHERE txid = ${input.txid} AND environment = ${input.environment}::"Environment"
        FOR UPDATE`;

      const current = locked[0];
      if (!current) return { applied: false, reason: 'not_found' as const };

      if (current.last_event_at && current.last_event_at > input.occurredAt) {
        return { applied: false, reason: 'stale_timestamp' as const };
      }
      if (current.status === input.toStatus) {
        return { applied: false, reason: 'same_state' as const };
      }

      const legal = checkTransition(PIX_CHARGE_STATUS_TRANSITIONS, current.status, input.toStatus);
      if (!legal.allowed) {
        return { applied: false, reason: 'illegal_transition' as const };
      }

      await tx.pixCharge.update({
        where: { id: current.id },
        data: {
          status: input.toStatus,
          paidAmountCents: input.paidAmountCents,
          paidAt: input.paidAt,
          lastEventAt: input.occurredAt,
          revision: { increment: 1 },
        },
      });

      await withTransactionalPorts(tx, () => input.withinTransaction?.(current.id));

      const row = await tx.pixCharge.findUniqueOrThrow({ where: { id: current.id } });
      return { applied: true, record: toPixCharge(row) };
    });
  }
}

@Injectable()
export class PrismaOperationRepository implements OperationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(environment: Environment, id: string) {
    const row = await this.prisma.client.providerOperation.findFirst({
      where: { environment, id },
    });
    return row ? toOperation(row) : undefined;
  }

  async create(record: OperationRecord) {
    const row = await this.prisma.client.providerOperation.create({
      data: {
        id: record.id,
        environment: record.environment,
        connectionId: record.connectionId,
        kind: record.kind,
        providerIdempotencyKey: record.providerIdempotencyKey,
        status: record.status,
        requestDigest: record.requestDigest,
        providerRef: record.providerRef ?? null,
        endToEndId: record.endToEndId ?? null,
        amountCents: record.amountCents ?? null,
        accountId: record.accountId ?? null,
        attempts: record.attempts,
      },
    });
    return toOperation(row);
  }

  async update(input: Parameters<OperationRepository['update']>[0]) {
    const result = await this.prisma.client.providerOperation.updateMany({
      where: { environment: input.environment, id: input.id },
      data: {
        status: input.status,
        providerRef: input.providerRef,
        endToEndId: input.endToEndId,
        lastError: (input.lastError ?? undefined) as Prisma.InputJsonValue | undefined,
        attempts: input.incrementAttempts ? { increment: 1 } : undefined,
      },
    });
    if (result.count === 0) return undefined;
    return this.findById(input.environment, input.id);
  }

  /**
   * Operacoes que ficaram sem desfecho.
   *
   * `UNKNOWN` primeiro, depois `SUBMITTED`: nao saber se o dinheiro saiu e
   * mais urgente do que saber que saiu e nao ter visto a confirmacao.
   */
  async findStuck(environment: Environment, limit: number) {
    const rows = await this.prisma.client.providerOperation.findMany({
      where: { environment, status: { in: ['UNKNOWN', 'SUBMITTED'] } },
      orderBy: [{ status: 'asc' }, { updatedAt: 'asc' }],
      take: limit,
    });
    return rows.map(toOperation);
  }
}

export function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toTransaction(row: Record<string, unknown>): TransactionRecord {
  const pix = row.pix as Record<string, unknown> | null | undefined;
  return {
    id: row.id as string,
    environment: row.environment as Environment,
    accountId: row.accountId as string,
    chargeId: (row.chargeId as string | null) ?? null,
    parentTransactionId: (row.parentTransactionId as string | null) ?? null,
    type: row.type as TransactionRecord['type'],
    direction: row.direction as TransactionRecord['direction'],
    status: row.status as TransactionStatus,
    lastEventAt: (row.lastEventAt as Date | null) ?? null,
    amountCents: row.amountCents as bigint,
    feeCents: row.feeCents as bigint,
    netAmountCents: row.netAmountCents as bigint,
    refundedAmountCents: row.refundedAmountCents as bigint,
    currency: row.currency as string,
    description: (row.description as string | null) ?? null,
    provider: row.provider as string,
    providerConnectionId: row.providerConnectionId as string,
    providerTransactionId: (row.providerTransactionId as string | null) ?? null,
    externalId: (row.externalId as string | null) ?? null,
    idempotencyKey: (row.idempotencyKey as string | null) ?? null,
    operationId: (row.operationId as string | null) ?? null,
    failureCode: (row.failureCode as string | null) ?? null,
    providerFailureCode: (row.providerFailureCode as string | null) ?? null,
    failureMessage: (row.failureMessage as string | null) ?? null,
    effectiveDate: toDateOnly(row.effectiveDate as Date),
    requestedAt: row.requestedAt as Date,
    settledAt: (row.settledAt as Date | null) ?? null,
    failedAt: (row.failedAt as Date | null) ?? null,
    ledgerPendingTransactionId: (row.ledgerPendingTransactionId as string | null) ?? null,
    ledgerPostedTransactionId: (row.ledgerPostedTransactionId as string | null) ?? null,
    pix: pix
      ? {
          endToEndId: (pix.endToEndId as string | null) ?? null,
          returnId: (pix.returnId as string | null) ?? null,
          originalEndToEndId: (pix.originalEndToEndId as string | null) ?? null,
          txid: (pix.txid as string | null) ?? null,
          initiationMethod: pix.initiationMethod as PixDetailInitiation,
          purpose: pix.purpose as PixDetailPurpose,
          keyType: (pix.keyType as PixDetailKeyType | null) ?? null,
          keyValue: (pix.keyValue as string | null) ?? null,
          counterparty: {
            name: (pix.counterpartyName as string | null) ?? null,
            taxIdLast4: (pix.counterpartyTaxIdLast4 as string | null) ?? null,
            taxIdIndex: (pix.counterpartyTaxIdIndex as string | null) ?? null,
            ispb: (pix.counterpartyIspb as string | null) ?? null,
            branch: (pix.counterpartyBranch as string | null) ?? null,
            accountNumber: (pix.counterpartyAccount as string | null) ?? null,
          },
          remittanceInfo: (pix.remittanceInfo as string | null) ?? null,
          settlementAt: (pix.settlementAt as Date | null) ?? null,
        }
      : null,
    metadata: (row.metadata as Record<string, string>) ?? {},
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}

type PixDetailInitiation = NonNullable<TransactionRecord['pix']>['initiationMethod'];
type PixDetailPurpose = NonNullable<TransactionRecord['pix']>['purpose'];
type PixDetailKeyType = NonNullable<NonNullable<TransactionRecord['pix']>['keyType']>;

function toPixKey(row: Record<string, unknown>): PixKeyRecord {
  return {
    id: row.id as string,
    environment: row.environment as Environment,
    accountId: row.accountId as string,
    type: row.type as PixKeyRecord['type'],
    value: row.value as string,
    valueBlindIndex: row.valueBlindIndex as string,
    status: row.status as PixKeyRecord['status'],
    providerKeyId: (row.providerKeyId as string | null) ?? null,
    requestedAt: row.requestedAt as Date,
    activatedAt: (row.activatedAt as Date | null) ?? null,
    removedAt: (row.removedAt as Date | null) ?? null,
  };
}

function toPixCharge(row: Record<string, unknown>): PixChargeRecord {
  return {
    id: row.id as string,
    environment: row.environment as Environment,
    accountId: row.accountId as string,
    pixKeyId: row.pixKeyId as string,
    kind: row.kind as PixChargeRecord['kind'],
    txid: row.txid as string,
    status: row.status as PixChargeStatus,
    revision: row.revision as number,
    amountCents: (row.amountCents as bigint | null) ?? null,
    paidAmountCents: row.paidAmountCents as bigint,
    amountIsChangeable: row.amountIsChangeable as boolean,
    currency: row.currency as string,
    expiresAt: (row.expiresAt as Date | null) ?? null,
    emvPayload: row.emvPayload as string,
    provider: row.provider as string,
    providerChargeId: (row.providerChargeId as string | null) ?? null,
    externalId: (row.externalId as string | null) ?? null,
    paidAt: (row.paidAt as Date | null) ?? null,
    lastEventAt: (row.lastEventAt as Date | null) ?? null,
    metadata: (row.metadata as Record<string, string>) ?? {},
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}

function toOperation(row: Record<string, unknown>): OperationRecord {
  return {
    id: row.id as string,
    environment: row.environment as Environment,
    connectionId: row.connectionId as string,
    kind: row.kind as string,
    providerIdempotencyKey: row.providerIdempotencyKey as string,
    status: row.status as OperationRecord['status'],
    requestDigest: row.requestDigest as string,
    providerRef: (row.providerRef as string | null) ?? null,
    endToEndId: (row.endToEndId as string | null) ?? null,
    amountCents: (row.amountCents as bigint | null) ?? null,
    accountId: (row.accountId as string | null) ?? null,
    attempts: row.attempts as number,
    lastError: (row.lastError as Record<string, unknown> | null) ?? null,
    nextTryAt: (row.nextTryAt as Date | null) ?? null,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}
