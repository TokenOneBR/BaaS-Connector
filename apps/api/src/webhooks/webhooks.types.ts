import type { Environment } from '@baasconn/taxonomy';

export const INBOUND_EVENT_REPOSITORY = Symbol('BAAS_INBOUND_EVENT_REPOSITORY');

export type InboundEventStatus =
  'RECEIVED' | 'PROCESSING' | 'PROCESSED' | 'DISCARDED' | 'FAILED' | 'DEAD_LETTER';

export interface InboundEventRecord {
  id: string;
  environment: Environment;
  connectionId: string;
  provider: string;
  dedupeKey: string;
  providerEventId?: string | null;
  eventTypeRaw?: string | null;
  occurredAt?: Date | null;
  receivedAt: Date;
  headers: Record<string, string>;
  payload: Buffer;
  rawSha256: string;
  signatureValid: boolean;
  status: InboundEventStatus;
  attempts: number;
  lastError?: string | null;
  processedAt?: Date | null;
}

export interface InboundEventRepository {
  /**
   * INSERT ... ON CONFLICT (connection_id, dedupe_key) DO NOTHING.
   *
   * Devolve `inserted: false` quando o evento ja existia — o provedor
   * reentregou. E a unica dedupe que importa, porque acontece ANTES de
   * qualquer trabalho.
   */
  claim(record: InboundEventRecord): Promise<{ inserted: boolean; record: InboundEventRecord }>;
  findById(id: string): Promise<InboundEventRecord | undefined>;
  markProcessing(id: string): Promise<boolean>;
  markProcessed(id: string, at: Date): Promise<void>;
  markDiscarded(id: string, reason: string): Promise<void>;
  markFailed(id: string, error: string, deadLetter: boolean): Promise<void>;
  /** Eventos presos em RECEIVED alem da janela, para o varredor reenfileirar. */
  findStale(olderThan: Date, limit: number): Promise<InboundEventRecord[]>;
}
