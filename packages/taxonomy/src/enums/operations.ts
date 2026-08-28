export enum OperationStatus {
  PENDING = 'PENDING',
  SUBMITTED = 'SUBMITTED',
  /** Timeout do provedor: desfecho indeterminado, aguardando conciliacao. */
  UNKNOWN = 'UNKNOWN',
  SETTLED = 'SETTLED',
  FAILED = 'FAILED',
}

export enum IdempotencyState {
  IN_FLIGHT = 'IN_FLIGHT',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum InboundEventStatus {
  RECEIVED = 'RECEIVED',
  PROCESSING = 'PROCESSING',
  PROCESSED = 'PROCESSED',
  /** Transicao obsoleta ou duplicada: absorvida pelo guard monotonico. */
  DISCARDED = 'DISCARDED',
  FAILED = 'FAILED',
  DEAD_LETTER = 'DEAD_LETTER',
}

export enum DeliveryStatus {
  PENDING = 'PENDING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  EXHAUSTED = 'EXHAUSTED',
}

export enum SubscriptionStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  DISABLED_BY_FAILURES = 'DISABLED_BY_FAILURES',
}

export enum ConnectionStatus {
  PENDING_VALIDATION = 'PENDING_VALIDATION',
  ACTIVE = 'ACTIVE',
  DEGRADED = 'DEGRADED',
  DISABLED = 'DISABLED',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
}

export enum ApiKeyStatus {
  ACTIVE = 'ACTIVE',
  REVOKED = 'REVOKED',
  EXPIRED = 'EXPIRED',
}

export enum AuditOutcome {
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE',
  DENIED = 'DENIED',
}

/** Papeis do console. Nunca alcancam rotas de movimentacao de dinheiro. */
export enum ConsoleRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  OPERATOR = 'OPERATOR',
  VIEWER = 'VIEWER',
  COMPLIANCE = 'COMPLIANCE',
}
