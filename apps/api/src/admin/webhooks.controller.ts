import {
  zAdminWebhookDelivery,
  zAdminWebhookEndpoint,
  zInboundWebhookEvent,
  zListDeliveriesQuery,
  zListInboundEventsQuery,
} from '@baasconn/contracts';
import { BaasError, BaasErrorCode } from '@baasconn/taxonomy';
import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { z } from 'zod';

import { Public } from '../auth/api-key.guard.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import {
  WEBHOOK_DELIVERY_REPOSITORY,
  WEBHOOK_ENDPOINT_REPOSITORY,
  type DeliveryListItem,
  type WebhookDeliveryRepository,
  type WebhookEndpointRepository,
  type WebhookEndpointSummary,
} from '../events/outbox-delivery.types.js';
import {
  INBOUND_EVENT_REPOSITORY,
  type InboundEventRecord,
  type InboundEventRepository,
} from '../webhooks/webhooks.types.js';

import { MinRole } from './admin-session.guard.js';
import { ConsoleEnvironmentPipe, type EnvironmentQuery } from './environment.query.js';
import { respond } from './respond.js';

/**
 * Webhooks: o que o provedor nos manda e o que mandamos ao cliente.
 *
 * Somente leitura. Reprocessar um evento de entrada e uma acao de escrita que
 * refaz uma mudanca de dominio, e ela nao entra por aqui: o caminho de
 * recuperacao de evento perdido e a CONCILIACAO, que decide pelo estado dos
 * tres lados em vez de pela vontade de quem clica. Um botao "reprocessar"
 * numa tela de log e o desenho em que um operador reaplica um evento antigo
 * por cima de um estado mais novo — exatamente o que o guard monotonico
 * existe para impedir, e que ele so impede porque ninguem contorna.
 *
 * `COMPLIANCE`, e nao `OPERATOR`: `COMPLIANCE` tem posto ABAIXO de `OPERATOR`
 * no ranking, e marcar leitura como OPERATOR trancaria quem audita.
 */
@Controller('admin/v1/webhooks')
@Public()
export class AdminWebhooksController {
  constructor(
    @Inject(INBOUND_EVENT_REPOSITORY) private readonly inbound: InboundEventRepository,
    @Inject(WEBHOOK_ENDPOINT_REPOSITORY) private readonly endpoints: WebhookEndpointRepository,
    @Inject(WEBHOOK_DELIVERY_REPOSITORY) private readonly deliveries: WebhookDeliveryRepository,
  ) {}

  @Get('inbound')
  @MinRole('COMPLIANCE')
  async listInbound(
    @Query(ConsoleEnvironmentPipe) env: EnvironmentQuery,
    @Query(new ZodValidationPipe(zListInboundEventsQuery))
    query: z.infer<typeof zListInboundEventsQuery>,
  ) {
    const page = await this.inbound.list({
      environment: env.environment,
      provider: query.provider,
      connectionId: query.connection_id,
      status: query.status,
      from: query.received_after ? new Date(query.received_after) : undefined,
      to: query.received_before ? new Date(query.received_before) : undefined,
      limit: query.limit,
      cursor: query.cursor,
    });

    return {
      object: 'list' as const,
      data: page.data.map(toInboundDto),
      page: {
        has_more: page.nextCursor !== undefined,
        next_cursor: page.nextCursor ?? null,
        prev_cursor: null,
        limit: query.limit,
      },
    };
  }

  @Get('inbound/:id')
  @MinRole('COMPLIANCE')
  async getInbound(@Query(ConsoleEnvironmentPipe) env: EnvironmentQuery, @Param('id') id: string) {
    const row = await this.inbound.findById(id);
    // Ambiente conferido AQUI e nao so no filtro da listagem: `findById` e por
    // chave primaria e nao passa pela extensao de escopo, entao sem esta linha
    // uma sessao apontando para homologacao leria um evento de producao pelo
    // id — que e justamente o que a separacao de ambientes existe para negar.
    if (!row || row.environment !== env.environment) {
      throw new BaasError(BaasErrorCode.RESOURCE_NOT_FOUND, {
        message: `Evento ${id} nao encontrado.`,
      });
    }
    return toInboundDto(row);
  }

  @Get('endpoints')
  @MinRole('COMPLIANCE')
  async listEndpoints(@Query(ConsoleEnvironmentPipe) env: EnvironmentQuery) {
    const rows = await this.endpoints.list(env.environment);
    return { object: 'list' as const, data: rows.map(toEndpointDto) };
  }

  @Get('deliveries')
  @MinRole('COMPLIANCE')
  async listDeliveries(
    @Query(ConsoleEnvironmentPipe) env: EnvironmentQuery,
    @Query(new ZodValidationPipe(zListDeliveriesQuery))
    query: z.infer<typeof zListDeliveriesQuery>,
  ) {
    const page = await this.deliveries.list({
      environment: env.environment,
      endpointId: query.endpoint_id,
      eventId: query.event_id,
      status: query.status,
      limit: query.limit,
      cursor: query.cursor,
    });

    return {
      object: 'list' as const,
      data: page.data.map(toDeliveryDto),
      page: {
        has_more: page.nextCursor !== undefined,
        next_cursor: page.nextCursor ?? null,
        prev_cursor: null,
        limit: query.limit,
      },
    };
  }
}

/**
 * `payload` sai como veio da tabela — que ja e o corpo REDIGIDO.
 *
 * A redacao acontece na fronteira do adapter-kit, antes de o objeto existir
 * como linha. Redigir de novo aqui daria a impressao de que esta e a defesa,
 * e a defesa real deixaria de ser testada.
 */
function toInboundDto(row: InboundEventRecord) {
  return respond(zInboundWebhookEvent, {
    id: row.id,
    environment: row.environment,
    provider: row.provider,
    connection_id: row.connectionId,
    event_type_raw: row.eventTypeRaw ?? null,
    provider_event_id: row.providerEventId ?? null,
    dedupe_key: row.dedupeKey,
    status: row.status,
    signature_valid: row.signatureValid,
    attempts: row.attempts,
    last_error: row.lastError ?? null,
    payload: parsePayload(row.payload),
    occurred_at: row.occurredAt?.toISOString() ?? null,
    received_at: row.receivedAt.toISOString(),
    processed_at: row.processedAt?.toISOString() ?? null,
  });
}

/**
 * O dobro em memoria guarda `Buffer`; o Prisma devolve `Json` ja parseado.
 *
 * A porta declara `Buffer` porque o handler grava os bytes crus, e e deles
 * que o sha256 sai. Aceitar as duas formas aqui mantem a tela identica sob os
 * dois repositorios — que e o unico ponto de ter dobro.
 */
function parsePayload(payload: unknown): unknown {
  if (!Buffer.isBuffer(payload)) return payload ?? null;
  try {
    return JSON.parse(payload.toString('utf8') || 'null');
  } catch {
    return null;
  }
}

function toEndpointDto(row: WebhookEndpointSummary) {
  return respond(zAdminWebhookEndpoint, {
    id: row.id,
    object: 'webhook_endpoint' as const,
    environment: row.environment,
    url: row.url,
    description: row.description ?? null,
    event_types: row.eventTypes,
    status: row.status,
    secret_set: row.secretSet,
    secret_rotating: row.secretRotating,
    previous_secret_expires_at: row.previousSecretExpiresAt?.toISOString() ?? null,
    consecutive_failures: row.consecutiveFailures,
    disabled_at: row.disabledAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  });
}

function toDeliveryDto(row: DeliveryListItem) {
  return respond(zAdminWebhookDelivery, {
    id: row.id,
    event_id: row.eventId,
    endpoint_id: row.endpointId,
    event_type: row.eventType ?? null,
    subject_id: row.subjectId ?? null,
    attempt: row.attempt,
    status: row.status,
    response_status: row.responseStatus ?? null,
    response_body_snippet: row.responseBodySnippet ?? null,
    error: row.error ?? null,
    duration_ms: row.durationMs ?? null,
    scheduled_for: row.scheduledFor.toISOString(),
    attempted_at: row.attemptedAt?.toISOString() ?? null,
  });
}
