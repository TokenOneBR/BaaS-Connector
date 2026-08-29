import { createHash } from 'node:crypto';

import {
  CLOCK,
  Metrics,
  OUTBOX_DISPATCH_REPOSITORY,
  WEBHOOK_DELIVERY_REPOSITORY,
  WEBHOOK_ENDPOINT_REPOSITORY,
  decideDelivery,
  matchesEventType,
  nextAttemptAt,
  type Clock,
  type DeliveryDecision,
  type ClaimedOutboxEvent,
  type EventQueue,
  type OutboxDispatchRepository,
  type WebhookDeliveryRepository,
  type WebhookEndpointRecord,
  type WebhookEndpointRepository,
} from '@baasconn/api/domain';
import { EVENT_QUEUE } from '@baasconn/api/domain';
import { buildWebhookSignature } from '@baasconn/crypto';
import {
  WEBHOOK_HEADERS,
  WEBHOOK_RETRY_SCHEDULE_SECONDS,
  newId,
} from '@baasconn/taxonomy';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { EndpointSecrets } from './endpoint-secrets.js';
import { toEventEnvelope } from './event-envelope.mapper.js';
import { WebhookTransport, type TransportResult } from './webhook-transport.js';

/** Falhas seguidas antes de desabilitar. */
const FAILURE_THRESHOLD = 5;
/** Reenfileiramento quando ha entrega anterior pendente do mesmo assunto. */
const ORDER_WAIT_MS = 200;

@Injectable()
export class OutboxDispatcherService {
  private readonly logger = new Logger(OutboxDispatcherService.name);

  constructor(
    private readonly transport: WebhookTransport,
    private readonly secrets: EndpointSecrets,
    private readonly metrics: Metrics,
    @Inject(OUTBOX_DISPATCH_REPOSITORY) private readonly outbox: OutboxDispatchRepository,
    @Inject(WEBHOOK_ENDPOINT_REPOSITORY) private readonly endpoints: WebhookEndpointRepository,
    @Inject(WEBHOOK_DELIVERY_REPOSITORY) private readonly deliveries: WebhookDeliveryRepository,
    @Inject(EVENT_QUEUE) private readonly queue: EventQueue,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Reivindica eventos e planeja o fan-out.
   *
   * O `dispatchedAt` gravado na reivindicacao significa "o fan-out foi
   * planejado", nao "o cliente recebeu": quem guarda isso e `webhook_delivery`.
   */
  async claimAndFanOut(limit = 500): Promise<number> {
    const now = this.clock.now();
    const events = await this.outbox.claimBatch(limit, now);
    if (events.length === 0) return 0;

    for (const event of events) await this.fanOut(event, now);
    return events.length;
  }

  private async fanOut(event: ClaimedOutboxEvent, now: Date): Promise<void> {
    const candidatos = await this.endpoints.listActive(event.environment);
    const alvos = candidatos.filter((endpoint) =>
      matchesEventType(endpoint.eventTypes, event.type),
    );

    if (alvos.length === 0) return;

    const linhas = alvos.map((endpoint) => ({
      id: newId('delivery'),
      eventId: event.id,
      endpointId: endpoint.id,
      scheduledFor: now,
    }));

    await this.deliveries.scheduleFirstAttempts(linhas);
    for (const linha of linhas) {
      await this.queue.enqueue({
        kind: 'outbox_dispatch',
        environment: event.environment,
        deliveryId: linha.id,
      });
    }
  }

  /**
   * Tenta uma entrega.
   *
   * A ordem por assunto e verificada ANTES de enviar: `pix_out.settled` nao
   * pode chegar ao cliente antes de `pix_out.pending`. Para quem consome
   * pagamento, fora de ordem e pior do que tarde.
   */
  async deliver(deliveryId: string, event: ClaimedOutboxEvent): Promise<void> {
    const delivery = await this.deliveries.findById(deliveryId);
    if (!delivery || delivery.status !== 'PENDING') return;

    const endpoint = await this.endpoints.findById(delivery.endpointId);
    if (!endpoint || endpoint.status !== 'ACTIVE') {
      await this.deliveries.complete({
        id: deliveryId,
        status: 'EXHAUSTED',
        durationMs: 0,
        error: 'endpoint inativo',
        attemptedAt: this.clock.now(),
        requestBodySha256: '',
      });
      return;
    }

    const anterior = await this.deliveries.hasEarlierPendingForSubject({
      endpointId: endpoint.id,
      subjectKind: event.subjectKind,
      subjectId: event.subjectId,
      sequence: event.sequence,
    });
    if (anterior) {
      await this.queue.enqueue(
        { kind: 'outbox_dispatch', environment: event.environment, deliveryId },
        { delayMs: ORDER_WAIT_MS },
      );
      return;
    }

    await this.send(delivery.id, delivery.attempt, endpoint, event);
  }

  private async send(
    deliveryId: string,
    attempt: number,
    endpoint: WebhookEndpointRecord,
    event: ClaimedOutboxEvent,
  ): Promise<void> {
    const now = this.clock.now();
    const body = JSON.stringify(toEventEnvelope(event, now));
    const timestamp = Math.floor(now.getTime() / 1000);
    const secrets = await this.secrets.for(endpoint);

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      [WEBHOOK_HEADERS.SIGNATURE]: buildWebhookSignature({
        payload: body,
        timestampSeconds: timestamp,
        secrets,
      }),
      [WEBHOOK_HEADERS.EVENT_ID]: event.id,
      [WEBHOOK_HEADERS.EVENT_TYPE]: event.type,
      [WEBHOOK_HEADERS.DELIVERY_ID]: deliveryId,
      [WEBHOOK_HEADERS.ATTEMPT]: String(attempt),
      [WEBHOOK_HEADERS.ENVIRONMENT]: event.environment,
      // Da ao cliente a deduplicacao de graca: reentrega nossa carrega a mesma
      // chave, e um consumidor que ja trate idempotencia nao precisa de codigo
      // novo para nos.
      'idempotency-key': event.id,
    };

    const resultado = await this.transport.post(endpoint.url, body, headers, now);
    const digest = createHash('sha256').update(body).digest('hex');

    await this.applyOutcome({ deliveryId, attempt, endpoint, event, resultado, digest, now });
  }

  private async applyOutcome(input: {
    deliveryId: string;
    attempt: number;
    endpoint: WebhookEndpointRecord;
    event: ClaimedOutboxEvent;
    resultado: TransportResult;
    digest: string;
    now: Date;
  }): Promise<void> {
    const { deliveryId, attempt, endpoint, event, resultado, digest, now } = input;

    const decisao: DeliveryDecision =
      resultado.kind === 'response'
        ? decideDelivery({
            status: resultado.status,
            retryAfterSeconds: resultado.retryAfterSeconds,
          })
        : { kind: 'retry', reason: resultado.error };

    const comum = {
      id: deliveryId,
      responseStatus: resultado.kind === 'response' ? resultado.status : undefined,
      responseBodySnippet: resultado.kind === 'response' ? resultado.bodySnippet : undefined,
      durationMs: resultado.durationMs,
      attemptedAt: now,
      requestBodySha256: digest,
    };

    this.metrics.webhookEvents.inc({
      provider: event.provider ?? 'none',
      type: 'outbound',
      outcome: decisao.kind,
    });

    if (decisao.kind === 'succeeded') {
      await this.deliveries.complete({ ...comum, status: 'SUCCEEDED' });
      await this.endpoints.resetFailures(endpoint.id);
      return;
    }

    if (decisao.kind === 'disable_endpoint') {
      await this.deliveries.complete({ ...comum, status: 'EXHAUSTED', error: decisao.reason });
      await this.endpoints.disable(endpoint.id, now, decisao.reason);
      // Um 410 encerra TUDO que estava na fila daquele endpoint: continuar
      // batendo depois dele e ignorar o que o cliente disse.
      const encerradas = await this.deliveries.exhaustPendingForEndpoint(
        endpoint.id,
        decisao.reason,
      );
      this.logger.warn(
        { endpoint_id: endpoint.id, encerradas },
        'Endpoint desabilitado por 410 Gone',
      );
      return;
    }

    const proxima = nextAttemptAt({
      attempt,
      schedule: WEBHOOK_RETRY_SCHEDULE_SECONDS,
      retryAfterSeconds: decisao.kind === 'retry' ? decisao.retryAfterSeconds : undefined,
      now,
    });

    if (!proxima) {
      await this.deliveries.complete({ ...comum, status: 'EXHAUSTED', error: decisao.reason });
      // A contagem sobe uma vez por ENTREGA esgotada, nao por tentativa:
      // senao um unico evento morto queima os 5 e desabilita um endpoint que
      // perdeu um evento so.
      const { disabled } = await this.endpoints.registerFailure(
        endpoint.id,
        FAILURE_THRESHOLD,
        now,
      );
      if (disabled) {
        this.logger.warn({ endpoint_id: endpoint.id }, 'Endpoint desabilitado por falhas seguidas');
      }
      return;
    }

    await this.deliveries.complete({ ...comum, status: 'FAILED', error: decisao.reason });
    const proximoId = newId('delivery');
    await this.deliveries.scheduleRetry({
      id: proximoId,
      eventId: event.id,
      endpointId: endpoint.id,
      attempt: attempt + 1,
      scheduledFor: proxima,
    });
    await this.queue.enqueue(
      { kind: 'outbox_dispatch', environment: event.environment, deliveryId: proximoId },
      { delayMs: proxima.getTime() - now.getTime() },
    );
  }

  /** Alimenta `baas_outbox_pending` e `baas_outbox_oldest_age_seconds`. */
  async reportMetrics(): Promise<void> {
    const { pending, oldestAgeSeconds } = await this.outbox.pendingStats();
    this.metrics.outboxPending.set(pending);
    this.metrics.outboxOldestAgeSeconds.set(oldestAgeSeconds);
  }
}
