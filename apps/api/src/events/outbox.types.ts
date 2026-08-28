import type { ActorType, Environment, EventType } from '@baasconn/taxonomy';

export const OUTBOX_REPOSITORY = Symbol('BAAS_OUTBOX_REPOSITORY');
export const AUDIT_REPOSITORY = Symbol('BAAS_AUDIT_REPOSITORY');
export const EVENT_QUEUE = Symbol('BAAS_EVENT_QUEUE');

export interface OutboxDraft {
  environment: Environment;
  type: EventType;
  provider?: string;
  connectionId?: string;
  subjectKind: string;
  subjectId: string;
  payload: Record<string, unknown>;
  previous?: Record<string, unknown>;
  occurredAt: Date;
}

/**
 * Outbox transacional.
 *
 * O evento e inserido na MESMA transacao da mudanca de dominio. E a unica
 * forma de garantir as duas metades da promessa: nunca contamos ao cliente um
 * pagamento que nao registramos, e nunca deixamos de contar um que
 * registramos. Publicar direto de dentro do handler quebra a segunda metade no
 * primeiro rollback.
 */
export interface OutboxRepository {
  append(draft: OutboxDraft): Promise<void>;
}

export interface AuditDraft {
  environment: Environment;
  actorType: ActorType;
  actorId?: string;
  actorLabel?: string;
  actorIp?: string;
  action: string;
  outcome: 'SUCCESS' | 'FAILURE' | 'DENIED';
  errorCode?: string;
  resourceType: string;
  resourceId?: string;
  connectionId?: string;
  provider?: string;
  /** Ja redigidos: nenhum segredo ou documento em claro chega aqui. */
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  changedFields?: string[];
  requestId?: string;
  operationId?: string;
  occurredAt: Date;
}

/**
 * Trilha de auditoria.
 *
 * Somente insercao. A cadeia de hash e um trigger `BEFORE INSERT` no banco e o
 * papel da aplicacao nao tem UPDATE nem DELETE na tabela, entao o repositorio
 * nao expoe — nem poderia expor — como alterar uma linha.
 */
export interface AuditRepository {
  record(draft: AuditDraft): Promise<void>;
}

export interface QueuedJob {
  kind: 'inbound_webhook';
  eventId: string;
}

/**
 * Fila de trabalho.
 *
 * Porta de proposito: hoje a implementacao e em processo, no marco do worker
 * ela vira BullMQ. Trocar e mudar o binding no modulo — o
 * `WebhookApplyService`, que tem toda a logica de dominio, nao sabe qual das
 * duas esta ligada.
 */
export interface EventQueue {
  enqueue(job: QueuedJob): Promise<void>;
  /** Aguarda a fila drenar. Existe para o teste, nao para producao. */
  drain(): Promise<void>;
}
