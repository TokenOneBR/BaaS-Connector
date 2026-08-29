import type { ClaimedOutboxEvent } from '@baasconn/api/domain';
import { Environment } from '@baasconn/taxonomy';

/**
 * Evento de outbox para o envelope que o cliente recebe.
 *
 * `sequence` sai como STRING porque e `BigInt` no banco: `JSON.stringify`
 * lanca em bigint, e a entrega falharia para sempre, num caminho que so roda
 * em producao.
 *
 * `livemode` espelha a convencao da Stripe e e a unica coisa no corpo que
 * distingue um evento de homologacao de um de producao. Um consumidor que
 * processe os dois na mesma fila depende disso.
 */
export function toEventEnvelope(
  event: ClaimedOutboxEvent,
  publishedAt: Date,
): Record<string, unknown> {
  return {
    id: event.id,
    object: 'event',
    type: event.type,
    spec_version: '1.0',
    data_version: event.dataVersion,
    environment: event.environment,
    provider: event.provider ?? null,
    connection_id: event.connectionId ?? null,
    resource: { type: event.subjectKind, id: event.subjectId },
    sequence: event.sequence.toString(),
    occurred_at: event.occurredAt.toISOString(),
    published_at: publishedAt.toISOString(),
    data: event.payload ?? null,
    previous: event.previous ?? undefined,
    livemode: event.environment === Environment.PRODUCAO,
  };
}
