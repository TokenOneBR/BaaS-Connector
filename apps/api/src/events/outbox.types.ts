import type { ActorType, Environment, EventType, ReconciliationScope } from '@baasconn/taxonomy';

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

export interface InboundWebhookJob {
  kind: 'inbound_webhook';
  eventId: string;
}

export interface OutboxDispatchJob {
  kind: 'outbox_dispatch';
  environment: Environment;
  deliveryId: string;
}

export interface OperationResolveJob {
  kind: 'operation_resolve';
  environment: Environment;
  operationId: string;
  /** Degrau da escada. Faz parte do jobId, para o mesmo degrau nao duplicar. */
  step: number;
}

/**
 * Varredura que CRIA as execucoes do dia.
 *
 * Existe separado do `reconciliation` porque o job de execucao carrega um
 * `runId` — o run precisa existir antes. Este e quem enumera as conexoes
 * ativas e as contas de cada uma, cria um run por (conexao, conta) e
 * enfileira a execucao.
 *
 * Vai para a fila `maintenance`, de concorrencia 1: uma varredura por vez no
 * cluster inteiro e exatamente o que enumerar contas e criar runs precisa.
 */
export interface ReconciliationSweepJob {
  kind: 'reconciliation_sweep';
  scope: ReconciliationScope;
}

export interface ReconciliationJob {
  kind: 'reconciliation';
  environment: Environment;
  runId: string;
}

export interface PollJob {
  kind: 'poll';
  connectionId: string;
  stream: string;
  scopeId?: string;
}

/**
 * Uniao discriminada de tudo que roda em segundo plano.
 *
 * Alargar uma uniao e seguro para quem PRODUZ: a API so enfileira
 * `inbound_webhook`, e o consumidor em processo ja estreita com um `if` sobre
 * `kind`, entao os outros ramos viram no-op dentro do processo dela.
 */
export type QueuedJob =
  | InboundWebhookJob
  | OutboxDispatchJob
  | OperationResolveJob
  | ReconciliationSweepJob
  | ReconciliationJob
  | PollJob;

/**
 * Fila de trabalho.
 *
 * Porta de proposito: hoje a implementacao e em processo, no marco do worker
 * ela vira BullMQ. Trocar e mudar o binding no modulo — o
 * `WebhookApplyService`, que tem toda a logica de dominio, nao sabe qual das
 * duas esta ligada.
 */
export interface EventQueue {
  /**
   * Enfileira um trabalho.
   *
   * `delayMs` e a escada de retry: o consumidor grava o proximo passo no
   * Postgres e agenda o despertador aqui. A escada NAO vive na fila — uma
   * escada que so existe no Redis e uma escada que um `FLUSHALL` apaga, e o
   * cliente perde o evento sem nenhum rastro.
   */
  enqueue(job: QueuedJob, options?: { delayMs?: number }): Promise<void>;
  /** Aguarda a fila drenar. Existe para o teste, nao para producao. */
  drain(): Promise<void>;
}
