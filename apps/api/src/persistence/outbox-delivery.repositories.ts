import type { Environment, EventType } from '@baasconn/taxonomy';
import { Injectable } from '@nestjs/common';

import type {
  ClaimedOutboxEvent,
  DeliveryFilter,
  DeliveryListItem,
  DeliveryStatusValue,
  DueDelivery,
  OutboxDispatchRepository,
  WebhookDeliveryRecord,
  WebhookDeliveryRepository,
  WebhookEndpointRecord,
  WebhookEndpointRepository,
  WebhookEndpointSummary,
} from '../events/outbox-delivery.types.js';

import { PrismaService } from './prisma.service.js';

@Injectable()
export class PrismaOutboxDispatchRepository implements OutboxDispatchRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reivindica um lote de eventos ainda nao despachados.
   *
   * `FOR UPDATE SKIP LOCKED` porque o Prisma nao expoe lock pessimista e
   * porque e exatamente a primitiva certa: N pods varrem a MESMA tabela e cada
   * um leva um lote disjunto, sem coordenacao e sem lider. Sem `SKIP LOCKED`
   * os pods esperariam uns aos outros e a vazao seria a de um pod so.
   *
   * `ORDER BY id`: o id e ULID, portanto ordenado no tempo, e o indice
   * `(dispatched_at, id)` serve esta varredura sem ordenacao extra.
   *
   * A varredura cruza AMBIENTES de proposito — o despachante e do processo,
   * nao de uma requisicao. Quem restaura o escopo e o `runWithContext` por
   * evento, no worker.
   */
  async claimBatch(limit: number, at: Date): Promise<ClaimedOutboxEvent[]> {
    return this.prisma.client.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<Record<string, unknown>>>`
        WITH reivindicados AS (
          SELECT id
            FROM outbox_event
           WHERE dispatched_at IS NULL
           ORDER BY id
             FOR UPDATE SKIP LOCKED
           LIMIT ${limit}
        )
        UPDATE outbox_event e
           SET dispatched_at = ${at}
          FROM reivindicados r
         WHERE e.id = r.id
        RETURNING e.id, e.environment, e.type, e.data_version, e.provider,
                  e.connection_id, e.subject_kind, e.subject_id, e.sequence,
                  e.payload, e.previous, e.occurred_at, e.created_at`;

      return rows.map(toClaimedEvent);
    });
  }

  async findEventById(id: string): Promise<ClaimedOutboxEvent | undefined> {
    const rows = await this.prisma.client.$queryRaw<Array<Record<string, unknown>>>`
      SELECT id, environment, type, data_version, provider, connection_id,
             subject_kind, subject_id, sequence, payload, previous,
             occurred_at, created_at
        FROM outbox_event
       WHERE id = ${id}`;
    const row = rows[0];
    return row ? toClaimedEvent(row) : undefined;
  }

  async pendingStats(): Promise<{ pending: number; oldestAgeSeconds: number }> {
    const rows = await this.prisma.client.$queryRaw<
      Array<{ pending: bigint; oldest_age_seconds: number | null }>
    >`SELECT count(*) AS pending,
             EXTRACT(EPOCH FROM (now() - min(created_at)))::float8 AS oldest_age_seconds
        FROM outbox_event
       WHERE dispatched_at IS NULL`;

    const row = rows[0];
    return {
      pending: Number(row?.pending ?? 0n),
      oldestAgeSeconds: row?.oldest_age_seconds ?? 0,
    };
  }
}

@Injectable()
export class PrismaWebhookEndpointRepository implements WebhookEndpointRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listActive(environment: Environment): Promise<WebhookEndpointRecord[]> {
    const rows = await this.prisma.client.webhookEndpoint.findMany({
      where: { environment, status: 'ACTIVE' },
      orderBy: { id: 'asc' },
    });
    return rows.map(toEndpoint);
  }

  async findById(id: string): Promise<WebhookEndpointRecord | undefined> {
    const row = await this.prisma.client.webhookEndpoint.findUnique({ where: { id } });
    return row ? toEndpoint(row) : undefined;
  }

  /**
   * `select` explicito omitindo TODA coluna de envelope.
   *
   * Nao e `toEndpoint` com campos apagados depois: o ciphertext nunca chega a
   * sair do Postgres. Assim, mesmo um log de query ou um erro do Prisma que
   * imprima a linha nao carrega segredo nenhum.
   */
  async list(environment: Environment): Promise<WebhookEndpointSummary[]> {
    const rows = await this.prisma.client.webhookEndpoint.findMany({
      where: { environment },
      select: {
        id: true,
        environment: true,
        url: true,
        description: true,
        eventTypes: true,
        status: true,
        previousSecretExpiresAt: true,
        previousSecretKeyId: true,
        consecutiveFailures: true,
        disabledAt: true,
        createdAt: true,
      },
      orderBy: { id: 'desc' },
    });

    return rows.map((row) => ({
      id: row.id,
      environment: row.environment as Environment,
      url: row.url,
      description: row.description,
      eventTypes: row.eventTypes,
      status: row.status,
      // Toda linha tem segredo: as colunas sao NOT NULL. O booleano existe
      // para o contrato ser o mesmo de uma conexao, cuja credencial e opcional.
      secretSet: true,
      secretRotating: row.previousSecretKeyId !== null,
      previousSecretExpiresAt: row.previousSecretExpiresAt,
      consecutiveFailures: row.consecutiveFailures,
      disabledAt: row.disabledAt,
      createdAt: row.createdAt,
    }));
  }

  /**
   * Conta a falha e desabilita ao cruzar o limiar, numa statement so.
   *
   * Read-modify-write entre dois workers perde contagem, e um endpoint que
   * deveria ter sido desabilitado na quinta falha seguiria recebendo.
   */
  async registerFailure(id: string, threshold: number, at: Date): Promise<{ disabled: boolean }> {
    const rows = await this.prisma.client.$queryRaw<Array<{ status: string }>>`
      UPDATE webhook_endpoint
         SET consecutive_failures = consecutive_failures + 1,
             status = CASE
               WHEN consecutive_failures + 1 >= ${threshold} THEN 'DISABLED_BY_FAILURES'::"SubscriptionStatus"
               ELSE status
             END,
             disabled_at = CASE
               WHEN consecutive_failures + 1 >= ${threshold} THEN ${at}
               ELSE disabled_at
             END,
             updated_at = now()
       WHERE id = ${id}
      RETURNING status`;

    return { disabled: rows[0]?.status === 'DISABLED_BY_FAILURES' };
  }

  /** So escreve quando havia falha: evita uma escrita por entrega bem-sucedida. */
  async resetFailures(id: string): Promise<void> {
    await this.prisma.client.webhookEndpoint.updateMany({
      where: { id, consecutiveFailures: { gt: 0 } },
      data: { consecutiveFailures: 0 },
    });
  }

  async disable(id: string, at: Date, reason: string): Promise<void> {
    void reason;
    await this.prisma.client.webhookEndpoint.update({
      where: { id },
      data: { status: 'DISABLED_BY_FAILURES', disabledAt: at },
    });
  }
}

@Injectable()
export class PrismaWebhookDeliveryRepository implements WebhookDeliveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async scheduleFirstAttempts(
    rows: Array<{ id: string; eventId: string; endpointId: string; scheduledFor: Date }>,
  ): Promise<void> {
    if (rows.length === 0) return;
    // A unica de (evento, endpoint, tentativa) torna isto idempotente: o
    // mesmo evento reivindicado duas vezes nao gera duas entregas.
    await this.prisma.client.webhookDelivery.createMany({
      data: rows.map((row) => ({ ...row, attempt: 1, status: 'PENDING' as const })),
      skipDuplicates: true,
    });
  }

  async scheduleRetry(row: {
    id: string;
    eventId: string;
    endpointId: string;
    attempt: number;
    scheduledFor: Date;
  }): Promise<void> {
    await this.prisma.client.webhookDelivery.createMany({
      data: [{ ...row, status: 'PENDING' as const }],
      skipDuplicates: true,
    });
  }

  async findById(id: string): Promise<WebhookDeliveryRecord | undefined> {
    const row = await this.prisma.client.webhookDelivery.findUnique({ where: { id } });
    return row ? toDelivery(row) : undefined;
  }

  /**
   * Listagem para o console, com o tipo e o sujeito vindos do evento por join.
   *
   * O ambiente tambem vem do evento: `webhook_delivery` nao tem a coluna, e
   * filtrar sem ela deixaria a tela de homologacao mostrar entrega de
   * producao. Keyset pelo id, que e ULID.
   */
  async list(filter: DeliveryFilter): Promise<{ data: DeliveryListItem[]; nextCursor?: string }> {
    const rows = await this.prisma.client.webhookDelivery.findMany({
      where: {
        endpointId: filter.endpointId,
        eventId: filter.eventId,
        status: filter.status,
        id: filter.cursor ? { lt: filter.cursor } : undefined,
        event: { environment: filter.environment },
      },
      include: { event: { select: { type: true, subjectId: true } } },
      orderBy: { id: 'desc' },
      take: filter.limit + 1,
    });

    const data = rows.slice(0, filter.limit).map((row) => ({
      ...toDelivery(row),
      eventType: row.event.type,
      subjectId: row.event.subjectId,
      responseBodySnippet: row.responseBodySnippet,
      durationMs: row.durationMs,
    }));

    return { data, nextCursor: rows.length > filter.limit ? data.at(-1)?.id : undefined };
  }

  /**
   * Entregas prontas para tentar.
   *
   * Existe alem do enfileiramento direto porque cobre o pod que morreu entre
   * gravar a linha e enfileirar o job — e e o que torna a escada de 72h
   * duravel em vez de dependente do Redis.
   */
  async claimDue(limit: number, now: Date): Promise<DueDelivery[]> {
    // O `FOR UPDATE` trava so `d`: travar tambem a linha do evento poria dois
    // varredores em contencao sobre um evento que ninguem vai alterar.
    const rows = await this.prisma.client.$queryRaw<Array<Record<string, unknown>>>`
      SELECT d.id, d.event_id, d.endpoint_id, d.attempt, d.status, d.scheduled_for,
             d.attempted_at, d.response_status, d.error, e.environment
        FROM webhook_delivery d
        JOIN outbox_event e ON e.id = d.event_id
       WHERE d.status = 'PENDING' AND d.scheduled_for <= ${now}
       ORDER BY d.scheduled_for
         FOR UPDATE OF d SKIP LOCKED
       LIMIT ${limit}`;
    return rows.map((row) => ({
      ...toDelivery(row),
      environment: row.environment as Environment,
    }));
  }

  async complete(input: Parameters<WebhookDeliveryRepository['complete']>[0]): Promise<void> {
    await this.prisma.client.webhookDelivery.update({
      where: { id: input.id },
      data: {
        status: input.status,
        responseStatus: input.responseStatus,
        responseBodySnippet: input.responseBodySnippet,
        durationMs: input.durationMs,
        error: input.error?.slice(0, 512),
        attemptedAt: input.attemptedAt,
        requestBodySha256: input.requestBodySha256,
      },
    });
  }

  async exhaustPendingForEndpoint(endpointId: string, reason: string): Promise<number> {
    const result = await this.prisma.client.webhookDelivery.updateMany({
      where: { endpointId, status: 'PENDING' },
      data: { status: 'EXHAUSTED', error: reason.slice(0, 512) },
    });
    return result.count;
  }

  /**
   * Ha entrega anterior pendente para o mesmo assunto?
   *
   * `sequence` do outbox e monotonico por ambiente, entao "anterior" e
   * decidivel sem relogio. E o que impede o cliente de ver `pix_out.settled`
   * antes de `pix_out.pending` — para quem consome pagamento, chegar fora de
   * ordem e pior do que chegar tarde.
   */
  async hasEarlierPendingForSubject(input: {
    endpointId: string;
    subjectKind: string;
    subjectId: string;
    sequence: bigint;
  }): Promise<boolean> {
    const rows = await this.prisma.client.$queryRaw<Array<{ existe: boolean }>>`
      SELECT EXISTS (
        SELECT 1
          FROM webhook_delivery d
          JOIN outbox_event e ON e.id = d.event_id
         WHERE d.endpoint_id = ${input.endpointId}
           AND d.status = 'PENDING'
           AND e.subject_kind = ${input.subjectKind}
           AND e.subject_id = ${input.subjectId}
           AND e.sequence < ${input.sequence}
      ) AS existe`;
    return rows[0]?.existe ?? false;
  }
}

function toClaimedEvent(row: Record<string, unknown>): ClaimedOutboxEvent {
  return {
    id: row.id as string,
    environment: row.environment as Environment,
    type: row.type as EventType,
    dataVersion: Number(row.data_version ?? 1),
    provider: (row.provider as string | null) ?? null,
    connectionId: (row.connection_id as string | null) ?? null,
    subjectKind: row.subject_kind as string,
    subjectId: row.subject_id as string,
    sequence: BigInt(row.sequence as string | number | bigint),
    payload: row.payload,
    previous: row.previous,
    occurredAt: row.occurred_at as Date,
    createdAt: row.created_at as Date,
  };
}

function toEndpoint(row: Record<string, unknown>): WebhookEndpointRecord {
  const previous =
    row.previousSecretCiphertext &&
    row.previousSecretIv &&
    row.previousSecretTag &&
    row.previousSecretWrappedKey &&
    row.previousSecretKeyId
      ? {
          ciphertext: Buffer.from(row.previousSecretCiphertext as Uint8Array),
          iv: Buffer.from(row.previousSecretIv as Uint8Array),
          authTag: Buffer.from(row.previousSecretTag as Uint8Array),
          wrappedKey: Buffer.from(row.previousSecretWrappedKey as Uint8Array),
          keyId: row.previousSecretKeyId as string,
          version: 1,
        }
      : null;

  return {
    id: row.id as string,
    environment: row.environment as Environment,
    url: row.url as string,
    eventTypes: (row.eventTypes as string[]) ?? [],
    secret: {
      ciphertext: Buffer.from(row.secretCiphertext as Uint8Array),
      iv: Buffer.from(row.secretIv as Uint8Array),
      authTag: Buffer.from(row.secretTag as Uint8Array),
      wrappedKey: Buffer.from(row.secretWrappedKey as Uint8Array),
      keyId: row.secretKeyId as string,
      version: 1,
    },
    previousSecret: previous,
    previousSecretExpiresAt: (row.previousSecretExpiresAt as Date | null) ?? null,
    status: row.status as WebhookEndpointRecord['status'],
    consecutiveFailures: Number(row.consecutiveFailures ?? 0),
    disabledAt: (row.disabledAt as Date | null) ?? null,
    updatedAt: row.updatedAt as Date,
  };
}

function toDelivery(row: Record<string, unknown>): WebhookDeliveryRecord {
  return {
    id: row.id as string,
    eventId: (row.event_id ?? row.eventId) as string,
    endpointId: (row.endpoint_id ?? row.endpointId) as string,
    attempt: Number(row.attempt),
    status: row.status as DeliveryStatusValue,
    scheduledFor: (row.scheduled_for ?? row.scheduledFor) as Date,
    attemptedAt: ((row.attempted_at ?? row.attemptedAt) as Date | null) ?? null,
    responseStatus: ((row.response_status ?? row.responseStatus) as number | null) ?? null,
    error: (row.error as string | null) ?? null,
  };
}
