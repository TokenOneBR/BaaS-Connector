export enum PixKeyType {
  CPF = 'CPF',
  CNPJ = 'CNPJ',
  EMAIL = 'EMAIL',
  PHONE = 'PHONE',
  /** Chave aleatoria (EVP), formato UUID. */
  EVP = 'EVP',
}

export enum PixKeyStatus {
  PENDING_REGISTRATION = 'PENDING_REGISTRATION',
  /** Confirmacao de posse de email/telefone. */
  PENDING_OWNERSHIP_CONFIRMATION = 'PENDING_OWNERSHIP_CONFIRMATION',
  ACTIVE = 'ACTIVE',
  PENDING_PORTABILITY_IN = 'PENDING_PORTABILITY_IN',
  PENDING_PORTABILITY_OUT = 'PENDING_PORTABILITY_OUT',
  PENDING_CLAIM_IN = 'PENDING_CLAIM_IN',
  PENDING_CLAIM_OUT = 'PENDING_CLAIM_OUT',
  REMOVED = 'REMOVED',
  REJECTED = 'REJECTED',
}

export enum PixClaimType {
  PORTABILITY = 'PORTABILITY',
  OWNERSHIP = 'OWNERSHIP',
}

/**
 * O BACEN distingue `cob` (imediata) de `cobv` (com vencimento). Mantemos a
 * distincao em vez de achatar: cobv carrega juros, multa e desconto, que nao
 * existem em cob.
 */
export enum PixChargeKind {
  STATIC = 'STATIC',
  DYNAMIC_IMMEDIATE = 'DYNAMIC_IMMEDIATE',
  DYNAMIC_DUE = 'DYNAMIC_DUE',
}

export enum PixChargeStatus {
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  EXPIRED = 'EXPIRED',
  REMOVED_BY_PSP = 'REMOVED_BY_PSP',
  REMOVED_BY_USER = 'REMOVED_BY_USER',
}

export enum PixInitiationMethod {
  /** Dados bancarios digitados. */
  MANUAL = 'MANUAL',
  KEY = 'KEY',
  /** QRES. */
  STATIC_QRCODE = 'STATIC_QRCODE',
  /** QRDN. */
  DYNAMIC_QRCODE = 'DYNAMIC_QRCODE',
  COPY_PASTE = 'COPY_PASTE',
  /** INIC, Open Finance. */
  PAYMENT_INITIATOR = 'PAYMENT_INITIATOR',
}

export enum PixPurpose {
  TRANSFER = 'TRANSFER',
  PURCHASE = 'PURCHASE',
  /** Pix Saque. */
  WITHDRAWAL = 'WITHDRAWAL',
  /** Pix Troco. */
  CHANGE = 'CHANGE',
}

export enum PixAccountType {
  CHECKING = 'CHECKING',
  SAVINGS = 'SAVINGS',
  PAYMENT = 'PAYMENT',
  SALARY = 'SALARY',
}

export enum PixRefundReasonCode {
  /** Mecanismo Especial de Devolucao. */
  FRAUD = 'FRAUD',
  OPERATIONAL_ERROR = 'OPERATIONAL_ERROR',
  REQUESTED_BY_PAYER = 'REQUESTED_BY_PAYER',
  MERCHANT_REFUND = 'MERCHANT_REFUND',
  SETTLEMENT_FAILURE = 'SETTLEMENT_FAILURE',
  ACCOUNT_CLOSED = 'ACCOUNT_CLOSED',
}

/** Janela regulatoria de devolucao PIX, em dias. */
export const PIX_REFUND_WINDOW_DAYS = 90;

/** Tamanho fixo do EndToEndId: 'E' + ISPB(8) + yyyyMMddHHmm + 11 alfanumericos. */
export const E2E_ID_LENGTH = 32;
