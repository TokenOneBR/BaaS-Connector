import type { Environment, EventType } from '@baasconn/taxonomy';

export const WEBHOOK_ENDPOINT_REPOSITORY = Symbol('BAAS_WEBHOOK_ENDPOINT_REPOSITORY');
export const WEBHOOK_DELIVERY_REPOSITORY = Symbol('BAAS_WEBHOOK_DELIVERY_REPOSITORY');
export const OUTBOX_DISPATCH_REPOSITORY = Symbol('BAAS_OUTBOX_DISPATCH_REPOSITORY');

/** Envelope de segredo, como sai do banco. O plaintext nunca e persistido. */
export interface SecretEnvelope {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  wrappedKey: Buffer;
  keyId: string;
  /** Versao da DEK. Faz parte da chave de cache, entao rotacionar invalida. */
  version: number;
}

export interface WebhookEndpointRecord {
  id: string;
  environment: Environment;
  url: string;
  /** Vazio significa TODOS, por contrato de `zCreateWebhookEndpoint`. */
  eventTypes: string[];
  secret: SecretEnvelope;
  /** Valido durante a rotacao; as duas assinaturas sao enviadas. */
  previousSecret?: SecretEnvelope | null;
  previousSecretExpiresAt?: Date | null;
  status: 'ACTIVE' | 'PAUSED' | 'DISABLED_BY_FAILURES';
  consecutiveFailures: number;
  disabledAt?: Date | null;
  updatedAt: Date;
}

/**
 * Endpoint como o console o ve.
 *
 * Nao tem `secret` nem `previousSecret` — nao por omissao do controller, mas
 * porque o TIPO nao os declara. Um controller pode esquecer de apagar um
 * campo; um tipo que nao tem o campo nao pode. E a mesma garantia estrutural
 * de `ConnectionSummary`, e o mesmo motivo: e a unica que sobrevive a um
 * refactor feito por quem nunca leu esta linha.
 */
export interface WebhookEndpointSummary {
  id: string;
  environment: Environment;
  url: string;
  description?: string | null;
  eventTypes: string[];
  status: 'ACTIVE' | 'PAUSED' | 'DISABLED_BY_FAILURES';
  secretSet: boolean;
  secretRotating: boolean;
  previousSecretExpiresAt?: Date | null;
  consecutiveFailures: number;
  disabledAt?: Date | null;
  createdAt: Date;
}

export interface WebhookEndpointRepository {
  listActive(environment: Environment): Promise<WebhookEndpointRecord[]>;
  /** Todos os endpoints do ambiente, inclusive pausados e desabilitados. */
  list(environment: Environment): Promise<WebhookEndpointSummary[]>;
  findById(id: string): Promise<WebhookEndpointRecord | undefined>;
  /**
   * Incremento ATOMICO.
   *
   * Read-modify-write entre dois workers perde contagem, e um endpoint que
   * deveria ter sido desabilitado na quinta falha seguiria recebendo.
   */
  registerFailure(id: string, threshold: number, at: Date): Promise<{ disabled: boolean }>;
  resetFailures(id: string): Promise<void>;
  disable(id: string, at: Date, reason: string): Promise<void>;
}

/** Evento reivindicado pelo despachante, pronto para o fan-out. */
export interface ClaimedOutboxEvent {
  id: string;
  environment: Environment;
  type: EventType;
  dataVersion: number;
  provider?: string | null;
  connectionId?: string | null;
  subjectKind: string;
  subjectId: string;
  sequence: bigint;
  payload: unknown;
  previous?: unknown;
  occurredAt: Date;
  createdAt: Date;
}

export interface OutboxDispatchRepository {
  /**
   * Reivindica um lote com `FOR UPDATE SKIP LOCKED`.
   *
   * `dispatchedAt` e gravado AQUI, na reivindicacao, e nao na entrega:
   * significa "o fan-out foi planejado", nao "o cliente recebeu" — quem guarda
   * isso e `webhook_delivery`. Marcar so depois do HTTP faria um endpoint
   * lento ser re-reivindicado a cada segundo, e o mesmo evento sairia N vezes.
   */
  claimBatch(limit: number, at: Date): Promise<ClaimedOutboxEvent[]>;
  /**
   * Busca um evento ja reivindicado, por id.
   *
   * O job de entrega carrega SO o `deliveryId` — de proposito, para o payload
   * do Redis nao ser uma segunda copia do evento que pode divergir da linha do
   * Postgres. Quem entrega precisa reler o evento, e e este o caminho.
   */
  findEventById(id: string): Promise<ClaimedOutboxEvent | undefined>;
  /** Metrica: quantos esperam, e ha quanto tempo o mais velho espera. */
  pendingStats(): Promise<{ pending: number; oldestAgeSeconds: number }>;
}

export type DeliveryStatusValue = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'EXHAUSTED';

export interface WebhookDeliveryRecord {
  id: string;
  eventId: string;
  endpointId: string;
  attempt: number;
  status: DeliveryStatusValue;
  scheduledFor: Date;
  attemptedAt?: Date | null;
  responseStatus?: number | null;
  error?: string | null;
}

/** Entrega vencida, com o ambiente do evento que a originou. */
export interface DueDelivery extends WebhookDeliveryRecord {
  environment: Environment;
}

/**
 * Entrega enriquecida com o tipo e o sujeito do evento, para a tela.
 *
 * O join sai daqui e nao do controller: a lista mostra "pix.out.settled do
 * txn_..." e nao "entrega da linha evt_...", e resolver isso com uma segunda
 * consulta por linha seria N+1 numa rota de listagem.
 */
export interface DeliveryListItem extends WebhookDeliveryRecord {
  eventType?: string | null;
  subjectId?: string | null;
  responseBodySnippet?: string | null;
  durationMs?: number | null;
}

export interface DeliveryFilter {
  environment: Environment;
  endpointId?: string;
  eventId?: string;
  status?: DeliveryStatusValue;
  limit: number;
  cursor?: string;
}

export interface WebhookDeliveryRepository {
  /** `skipDuplicates`: a unica de (evento, endpoint, tentativa) torna idempotente. */
  scheduleFirstAttempts(
    rows: Array<{ id: string; eventId: string; endpointId: string; scheduledFor: Date }>,
  ): Promise<void>;
  scheduleRetry(row: {
    id: string;
    eventId: string;
    endpointId: string;
    attempt: number;
    scheduledFor: Date;
  }): Promise<void>;
  findById(id: string): Promise<WebhookDeliveryRecord | undefined>;
  list(filter: DeliveryFilter): Promise<{ data: DeliveryListItem[]; nextCursor?: string }>;
  /**
   * Entregas prontas para tentar, com `FOR UPDATE SKIP LOCKED`.
   *
   * Devolve o AMBIENTE junto, vindo do evento por join. `webhook_delivery` nao
   * tem a coluna, e quem reenfileira precisa dela: inventar um ambiente no
   * varredor faria o job rodar sob o escopo errado.
   */
  claimDue(limit: number, now: Date): Promise<DueDelivery[]>;
  complete(input: {
    id: string;
    status: DeliveryStatusValue;
    responseStatus?: number;
    responseBodySnippet?: string;
    durationMs: number;
    error?: string;
    attemptedAt: Date;
    requestBodySha256: string;
  }): Promise<void>;
  /** Um 410 encerra tudo que estava na fila daquele endpoint. */
  exhaustPendingForEndpoint(endpointId: string, reason: string): Promise<number>;
  /**
   * Ha entrega ANTERIOR pendente para o mesmo assunto?
   *
   * `sequence` e monotonico por ambiente, entao "anterior" e decidivel. E o
   * que faz o cliente ver `pix.out.created` antes de `pix.out.settled`.
   */
  hasEarlierPendingForSubject(input: {
    endpointId: string;
    subjectKind: string;
    subjectId: string;
    sequence: bigint;
  }): Promise<boolean>;
}
