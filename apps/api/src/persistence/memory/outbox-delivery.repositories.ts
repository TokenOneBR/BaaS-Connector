import { Environment } from '@baasconn/taxonomy';

import type {
  ClaimedOutboxEvent,
  DeliveryFilter,
  DeliveryListItem,
  DueDelivery,
  OutboxDispatchRepository,
  WebhookDeliveryRecord,
  WebhookDeliveryRepository,
  WebhookEndpointRecord,
  WebhookEndpointRepository,
  WebhookEndpointSummary,
} from '../../events/outbox-delivery.types.js';

/**
 * Dobros de despacho.
 *
 * Reproduzem a semantica que decide correcao — reivindicacao unica, dedupe de
 * tentativa, ordem por `sequence` — e NAO a concorrencia: `SKIP LOCKED` com
 * varios pods so e provavel contra Postgres de verdade, e continua provado la.
 */
export class MemoryOutboxDispatchRepository implements OutboxDispatchRepository {
  readonly rows = new Map<string, ClaimedOutboxEvent & { dispatchedAt?: Date }>();
  /** O instante que a metrica usa como "agora". A versao Prisma usa `now()`. */
  referenceNow = new Date();

  async claimBatch(limit: number, at: Date): Promise<ClaimedOutboxEvent[]> {
    const pendentes = [...this.rows.values()]
      .filter((row) => !row.dispatchedAt)
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, limit);

    // Marca na reivindicacao, como a versao Prisma: sem isto, uma segunda
    // varredura antes da entrega terminar levaria o mesmo evento de novo.
    for (const row of pendentes) row.dispatchedAt = at;
    return pendentes.map(({ dispatchedAt: _ignorado, ...rest }) => rest);
  }

  async findEventById(id: string): Promise<ClaimedOutboxEvent | undefined> {
    const row = this.rows.get(id);
    if (!row) return undefined;
    const { dispatchedAt: _ignorado, ...rest } = row;
    return rest;
  }

  async pendingStats(): Promise<{ pending: number; oldestAgeSeconds: number }> {
    const pendentes = [...this.rows.values()].filter((row) => !row.dispatchedAt);
    const maisVelho = pendentes.reduce<Date | undefined>(
      (velho, row) => (!velho || row.createdAt < velho ? row.createdAt : velho),
      undefined,
    );
    return {
      pending: pendentes.length,
      oldestAgeSeconds: maisVelho ? (this.referenceNow.getTime() - maisVelho.getTime()) / 1000 : 0,
    };
  }
}

export class MemoryWebhookEndpointRepository implements WebhookEndpointRepository {
  readonly rows = new Map<string, WebhookEndpointRecord>();

  async listActive(environment: Environment): Promise<WebhookEndpointRecord[]> {
    return [...this.rows.values()]
      .filter((row) => row.environment === environment && row.status === 'ACTIVE')
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async findById(id: string): Promise<WebhookEndpointRecord | undefined> {
    return this.rows.get(id);
  }

  async list(environment: Environment): Promise<WebhookEndpointSummary[]> {
    return [...this.rows.values()]
      .filter((row) => row.environment === environment)
      .sort((a, b) => b.id.localeCompare(a.id))
      .map((row) => ({
        id: row.id,
        environment: row.environment,
        url: row.url,
        description: null,
        eventTypes: row.eventTypes,
        status: row.status,
        secretSet: true,
        secretRotating: row.previousSecret != null,
        previousSecretExpiresAt: row.previousSecretExpiresAt ?? null,
        consecutiveFailures: row.consecutiveFailures,
        disabledAt: row.disabledAt ?? null,
        createdAt: row.updatedAt,
      }));
  }

  async registerFailure(id: string, threshold: number, at: Date): Promise<{ disabled: boolean }> {
    const row = this.rows.get(id);
    if (!row) return { disabled: false };

    row.consecutiveFailures += 1;
    if (row.consecutiveFailures >= threshold) {
      row.status = 'DISABLED_BY_FAILURES';
      row.disabledAt = at;
    }
    return { disabled: row.status === 'DISABLED_BY_FAILURES' };
  }

  async resetFailures(id: string): Promise<void> {
    const row = this.rows.get(id);
    if (row) row.consecutiveFailures = 0;
  }

  async disable(id: string, at: Date): Promise<void> {
    const row = this.rows.get(id);
    if (!row) return;
    row.status = 'DISABLED_BY_FAILURES';
    row.disabledAt = at;
  }
}

export class MemoryWebhookDeliveryRepository implements WebhookDeliveryRepository {
  readonly rows = new Map<string, WebhookDeliveryRecord>();
  /** `eventId -> sequence`, para decidir "anterior" sem uma tabela de eventos. */
  readonly sequenceOf = new Map<string, bigint>();
  readonly subjectOf = new Map<string, { kind: string; id: string }>();
  /** `eventId -> type`, o outro lado do join com `outbox_event`. */
  readonly typeOf = new Map<string, string>();
  readonly environmentOf = new Map<string, Environment>();

  private key(eventId: string, endpointId: string, attempt: number): string {
    return `${eventId}|${endpointId}|${attempt}`;
  }

  async scheduleFirstAttempts(
    rows: Array<{ id: string; eventId: string; endpointId: string; scheduledFor: Date }>,
  ): Promise<void> {
    for (const row of rows) {
      const chave = this.key(row.eventId, row.endpointId, 1);
      if (
        [...this.rows.values()].some((r) => this.key(r.eventId, r.endpointId, r.attempt) === chave)
      ) {
        continue;
      }
      this.rows.set(row.id, { ...row, attempt: 1, status: 'PENDING' });
    }
  }

  async scheduleRetry(row: {
    id: string;
    eventId: string;
    endpointId: string;
    attempt: number;
    scheduledFor: Date;
  }): Promise<void> {
    this.rows.set(row.id, { ...row, status: 'PENDING' });
  }

  async findById(id: string): Promise<WebhookDeliveryRecord | undefined> {
    return this.rows.get(id);
  }

  async list(filter: DeliveryFilter): Promise<{ data: DeliveryListItem[]; nextCursor?: string }> {
    const rows = [...this.rows.values()]
      .filter(
        (row) =>
          (this.environmentOf.get(row.eventId) ?? Environment.HOMOLOGACAO) === filter.environment &&
          (!filter.endpointId || row.endpointId === filter.endpointId) &&
          (!filter.eventId || row.eventId === filter.eventId) &&
          (!filter.status || row.status === filter.status) &&
          (!filter.cursor || row.id < filter.cursor),
      )
      .sort((a, b) => (a.id < b.id ? 1 : -1));

    const data = rows.slice(0, filter.limit).map((row) => ({
      ...row,
      eventType: this.typeOf.get(row.eventId) ?? null,
      subjectId: this.subjectOf.get(row.eventId)?.id ?? null,
    }));

    return { data, nextCursor: rows.length > filter.limit ? data.at(-1)?.id : undefined };
  }

  async claimDue(limit: number, now: Date): Promise<DueDelivery[]> {
    return [...this.rows.values()]
      .filter((row) => row.status === 'PENDING' && row.scheduledFor <= now)
      .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime())
      .slice(0, limit)
      .map((row) => ({
        ...row,
        // O join com `outbox_event` da versao Prisma, aqui como mapa lateral —
        // mesma tecnica de `sequenceOf` e `subjectOf`.
        environment: this.environmentOf.get(row.eventId) ?? Environment.HOMOLOGACAO,
      }));
  }

  async complete(input: Parameters<WebhookDeliveryRepository['complete']>[0]): Promise<void> {
    const row = this.rows.get(input.id);
    if (!row) return;
    row.status = input.status;
    row.responseStatus = input.responseStatus ?? null;
    row.error = input.error ?? null;
    row.attemptedAt = input.attemptedAt;
  }

  async exhaustPendingForEndpoint(endpointId: string, reason: string): Promise<number> {
    let count = 0;
    for (const row of this.rows.values()) {
      if (row.endpointId === endpointId && row.status === 'PENDING') {
        row.status = 'EXHAUSTED';
        row.error = reason;
        count += 1;
      }
    }
    return count;
  }

  async hasEarlierPendingForSubject(input: {
    endpointId: string;
    subjectKind: string;
    subjectId: string;
    sequence: bigint;
  }): Promise<boolean> {
    return [...this.rows.values()].some((row) => {
      if (row.endpointId !== input.endpointId || row.status !== 'PENDING') return false;
      const subject = this.subjectOf.get(row.eventId);
      const sequence = this.sequenceOf.get(row.eventId);
      if (!subject || sequence === undefined) return false;
      return (
        subject.kind === input.subjectKind &&
        subject.id === input.subjectId &&
        sequence < input.sequence
      );
    });
  }
}
