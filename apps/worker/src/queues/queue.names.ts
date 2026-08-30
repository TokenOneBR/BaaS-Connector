import type { QueuedJob } from '@baasconn/api/domain';

/**
 * Uma fila por tipo de trabalho.
 *
 * Filas separadas, e nao uma so com filtro: uma rajada de entrega de webhook
 * nao pode atrasar a resolucao de um PIX em desfecho desconhecido, e cada uma
 * tem concorrencia e retry proprios. Com fila unica, a concorrencia teria de
 * ser o menor denominador comum de todas.
 */
export const QUEUE = {
  inboundWebhook: 'inbound-webhook',
  outboxDispatch: 'outbox-dispatch',
  operationResolve: 'operation-resolve',
  reconciliation: 'reconciliation',
  poll: 'poll',
  maintenance: 'maintenance',
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

export const QUEUE_FOR_KIND: Readonly<Record<QueuedJob['kind'], QueueName>> = Object.freeze({
  inbound_webhook: QUEUE.inboundWebhook,
  outbox_dispatch: QUEUE.outboxDispatch,
  operation_resolve: QUEUE.operationResolve,
  reconciliation_sweep: QUEUE.maintenance,
  reconciliation: QUEUE.reconciliation,
  poll: QUEUE.poll,
});

/**
 * Identidade estavel do job.
 *
 * O BullMQ recusa um segundo job com o mesmo `jobId`, e e disso que precisamos:
 * a reentrega do provedor, o varredor e o push do caminho quente podem
 * enfileirar o MESMO evento ao mesmo tempo. Sem isto, o dominio teria de ser
 * idempotente contra concorrencia, e nao so contra repeticao.
 *
 * O separador e `-` e nao `:` porque o BullMQ RECUSA dois-pontos em id
 * customizado: e o separador das proprias chaves dele no Redis. Os ULIDs nao
 * contem `-`, entao a chave continua sem ambiguidade.
 */
export function jobIdOf(job: QueuedJob): string {
  switch (job.kind) {
    case 'inbound_webhook':
      return `ibe-${job.eventId}`;
    case 'outbox_dispatch':
      return `dlv-${job.deliveryId}`;
    // O degrau entra na chave: reagendar o degrau 3 nao pode ser recusado
    // porque o degrau 2 ja existiu.
    case 'operation_resolve':
      return `opr-${job.operationId}-${job.step}`;
    case 'reconciliation_sweep':
      return `sweep-${job.scope}`;
    case 'reconciliation':
      return `rec-${job.runId}`;
    case 'poll':
      return `poll-${job.connectionId}-${job.stream}-${job.scopeId ?? 'all'}`;
  }
}

export interface QueuePolicy {
  concurrency: number;
  attempts: number;
  backoffMs?: number;
}

/**
 * Politica por fila.
 *
 * `attempts: 1` nas duas filas de escada NAO e ausencia de retry: a escada
 * vive no Postgres (`webhook_delivery.scheduled_for`, `provider_operation.
 * next_try_at`) e a fila e so o despertador. Retry do BullMQ por cima
 * duplicaria a escada e faria o cliente receber a mesma entrega duas vezes no
 * mesmo degrau.
 */
export const QUEUE_POLICY: Readonly<Record<QueueName, QueuePolicy>> = Object.freeze({
  [QUEUE.inboundWebhook]: { concurrency: 16, attempts: 3, backoffMs: 1_000 },
  [QUEUE.outboxDispatch]: { concurrency: 32, attempts: 1 },
  [QUEUE.operationResolve]: { concurrency: 8, attempts: 1 },
  [QUEUE.reconciliation]: { concurrency: 2, attempts: 3, backoffMs: 30_000 },
  [QUEUE.poll]: { concurrency: 4, attempts: 3, backoffMs: 5_000 },
  [QUEUE.maintenance]: { concurrency: 1, attempts: 1 },
});
