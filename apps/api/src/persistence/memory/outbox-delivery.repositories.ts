import type { Environment } from '@baasconn/taxonomy';

import type {
  ClaimedOutboxEvent,
  OutboxDispatchRepository,
  WebhookDeliveryRecord,
  WebhookDeliveryRepository,
  WebhookEndpointRecord,
  WebhookEndpointRepository,
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

  async pendingStats(): Promise<{ pending: number; oldestAgeSeconds: number }> {
    const pendentes = [...this.rows.values()].filter((row) => !row.dispatchedAt);
    const maisVelho = pendentes.reduce<Date | undefined>(
      (velho, row) => (!velho || row.createdAt < velho ? row.createdAt : velho),
      undefined,
    );
    return {
      pending: pendentes.length,
      oldestAgeSeconds: maisVelho
        ? (this.referenceNow.getTime() - maisVelho.getTime()) / 1000
        : 0,
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

  private key(eventId: string, endpointId: string, attempt: number): string {
    return `${eventId}|${endpointId}|${attempt}`;
  }

  async scheduleFirstAttempts(
    rows: Array<{ id: string; eventId: string; endpointId: string; scheduledFor: Date }>,
  ): Promise<void> {
    for (const row of rows) {
      const chave = this.key(row.eventId, row.endpointId, 1);
      if ([...this.rows.values()].some((r) => this.key(r.eventId, r.endpointId, r.attempt) === chave)) {
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

  async claimDue(limit: number, now: Date): Promise<WebhookDeliveryRecord[]> {
    return [...this.rows.values()]
      .filter((row) => row.status === 'PENDING' && row.scheduledFor <= now)
      .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime())
      .slice(0, limit);
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
