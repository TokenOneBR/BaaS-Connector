export enum AccountStatus {
  /** Criada localmente, ainda nao enviada ao provedor. */
  DRAFT = 'DRAFT',
  PENDING_ONBOARDING = 'PENDING_ONBOARDING',
  PENDING_DOCUMENTS = 'PENDING_DOCUMENTS',
  UNDER_REVIEW = 'UNDER_REVIEW',
  ACTIVE = 'ACTIVE',
  /** Reversivel: bloqueio judicial, compliance ou fraude. */
  BLOCKED = 'BLOCKED',
  /** Reversivel: suspensao a pedido do titular. */
  SUSPENDED = 'SUSPENDED',
  REJECTED = 'REJECTED',
  /** Encerramento em curso, drenando saldo. */
  CLOSING = 'CLOSING',
  CLOSED = 'CLOSED',
}

export enum AccountKind {
  PAYMENT = 'PAYMENT',
  CHECKING = 'CHECKING',
  SAVINGS = 'SAVINGS',
  ESCROW = 'ESCROW',
}
