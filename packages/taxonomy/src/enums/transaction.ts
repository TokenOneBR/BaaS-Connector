export enum TransactionType {
  PIX_IN = 'PIX_IN',
  PIX_OUT = 'PIX_OUT',
  /** Recebemos uma devolucao de volta. */
  PIX_REFUND_IN = 'PIX_REFUND_IN',
  /** Enviamos uma devolucao. */
  PIX_REFUND_OUT = 'PIX_REFUND_OUT',
  INTERNAL_TRANSFER_IN = 'INTERNAL_TRANSFER_IN',
  INTERNAL_TRANSFER_OUT = 'INTERNAL_TRANSFER_OUT',
  FEE = 'FEE',
  FEE_REVERSAL = 'FEE_REVERSAL',
  ADJUSTMENT_CREDIT = 'ADJUSTMENT_CREDIT',
  ADJUSTMENT_DEBIT = 'ADJUSTMENT_DEBIT',
  BLOCK = 'BLOCK',
  UNBLOCK = 'UNBLOCK',
}

export enum TransactionDirection {
  CREDIT = 'CREDIT',
  DEBIT = 'DEBIT',
}

export enum TransactionStatus {
  /** Aceita pelo conector, ainda nao enviada ao provedor. */
  CREATED = 'CREATED',
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SETTLED = 'SETTLED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  REVERSED = 'REVERSED',
  PARTIALLY_REVERSED = 'PARTIALLY_REVERSED',
  /**
   * Desfecho desconhecido: a chamada ao provedor deu timeout e nao sabemos se
   * o dinheiro se moveu. Nao e terminal. Um worker de conciliacao resolve
   * consultando o provedor pela idempotency key; nunca reenviamos.
   */
  UNKNOWN = 'UNKNOWN',
}

/** Estados a partir dos quais nao ha mais evolucao automatica. */
export const TERMINAL_TRANSACTION_STATUSES: ReadonlySet<TransactionStatus> = new Set([
  TransactionStatus.FAILED,
  TransactionStatus.CANCELLED,
  TransactionStatus.REVERSED,
]);

export enum StatementEntryType {
  PIX_IN = 'PIX_IN',
  PIX_OUT = 'PIX_OUT',
  FEE = 'FEE',
  REFUND = 'REFUND',
  ADJUSTMENT = 'ADJUSTMENT',
  OTHER = 'OTHER',
}
