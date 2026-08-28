import type { CurrencyCode } from '@baasconn/taxonomy';

/** Classificacao contabil. Determina o `normalBalance`. */
export enum LedgerAccountType {
  ASSET = 'ASSET',
  LIABILITY = 'LIABILITY',
  EQUITY = 'EQUITY',
  REVENUE = 'REVENUE',
  EXPENSE = 'EXPENSE',
}

export enum NormalBalance {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
}

export enum LedgerOwnerType {
  BANK = 'BANK',
  CUSTOMER = 'CUSTOMER',
  CLEARING = 'CLEARING',
  INTERNAL = 'INTERNAL',
  EXTERNAL = 'EXTERNAL',
}

export enum LedgerAccountStatus {
  OPEN = 'OPEN',
  FROZEN = 'FROZEN',
  CLOSED = 'CLOSED',
}

export enum EntryDirection {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
}

/**
 * Fase do lancamento.
 *
 * Duas fases nao sao luxo: um PIX out nao e atomico. O dinheiro precisa ser
 * reservado na autorizacao e capturado ou liberado quando o SPI confirma,
 * minutos depois. Sem fase pendente, ou se debita otimista e escreve
 * lancamento compensatorio na falha (poluindo o extrato do cliente com
 * transacao fantasma), ou se debita so na liquidacao e permite double-spend
 * na janela.
 */
export enum EntryPhase {
  PENDING = 'PENDING',
  POSTED = 'POSTED',
  VOID = 'VOID',
}

export enum LedgerTransactionStatus {
  PENDING = 'PENDING',
  POSTED = 'POSTED',
  VOIDED = 'VOIDED',
}

export enum LedgerTransactionType {
  PIX_OUT_AUTHORIZE = 'PIX_OUT_AUTHORIZE',
  PIX_OUT_SETTLE = 'PIX_OUT_SETTLE',
  PIX_OUT_VOID = 'PIX_OUT_VOID',
  PIX_IN_RECEIVE = 'PIX_IN_RECEIVE',
  PIX_REFUND_OUT = 'PIX_REFUND_OUT',
  PIX_REFUND_IN = 'PIX_REFUND_IN',
  FEE_CHARGE = 'FEE_CHARGE',
  FEE_REVERSAL = 'FEE_REVERSAL',
  BLOCK_FUNDS = 'BLOCK_FUNDS',
  UNBLOCK_FUNDS = 'UNBLOCK_FUNDS',
  ACCOUNT_OPENING_FUNDING = 'ACCOUNT_OPENING_FUNDING',
  MANUAL_ADJUSTMENT = 'MANUAL_ADJUSTMENT',
  SUSPENSE_RESOLUTION = 'SUSPENSE_RESOLUTION',
  RECONCILIATION_ADJUSTMENT = 'RECONCILIATION_ADJUSTMENT',
}

export const NORMAL_BALANCE_BY_TYPE: Readonly<Record<LedgerAccountType, NormalBalance>> =
  Object.freeze({
    [LedgerAccountType.ASSET]: NormalBalance.DEBIT,
    [LedgerAccountType.EXPENSE]: NormalBalance.DEBIT,
    [LedgerAccountType.LIABILITY]: NormalBalance.CREDIT,
    [LedgerAccountType.EQUITY]: NormalBalance.CREDIT,
    [LedgerAccountType.REVENUE]: NormalBalance.CREDIT,
  });

/**
 * Conta do razao com contadores materializados.
 *
 * Os quatro contadores vem do modelo do TigerBeetle. Sao materializados em vez
 * de derivados por SUM porque: uma subconta com 500 mil lancamentos tornaria
 * cada leitura de saldo um heap scan, e o caminho quente (PIX out) precisa do
 * saldo SOB LOCK. Trocar leitura O(1) por agregacao O(n) sob lock de escrita e
 * um precipicio de throughput. Materializar tambem e o que torna possivel a
 * guarda de saldo negativo como CHECK constraint, ja que um CHECK nao pode
 * agregar outra tabela.
 */
export interface LedgerAccount {
  id: string;
  /** Codigo do plano de contas, ex.: "2000.acc_01JB...". */
  code: string;
  name: string;
  type: LedgerAccountType;
  normalBalance: NormalBalance;
  currency: CurrencyCode;
  ownerType: LedgerOwnerType;
  ownerId?: string;
  status: LedgerAccountStatus;
  /** Apenas contas internas de clearing podem ficar negativas. */
  allowsNegative: boolean;

  debitsPosted: bigint;
  creditsPosted: bigint;
  debitsPending: bigint;
  creditsPending: bigint;
  entryCount: bigint;
  version: bigint;
}

export interface LedgerEntryInput {
  accountId: string;
  direction: EntryDirection;
  /** Sempre positivo. O sinal vive em `direction`. */
  amountCents: bigint;
}

export interface LedgerEntry extends LedgerEntryInput {
  id: string;
  transactionId: string;
  phase: EntryPhase;
  currency: CurrencyCode;
  /** Posicao dentro da transacao, para ordenacao estavel. */
  sequence: number;
  /** Snapshot do saldo postado da conta imediatamente apos este lancamento. */
  resultingPostedCents: bigint;
  effectiveAt: Date;
}

export interface LedgerTransaction {
  id: string;
  type: LedgerTransactionType;
  status: LedgerTransactionStatus;
  currency: CurrencyCode;
  /** Total de um lado. Debitos e creditos sao iguais por construcao. */
  amountCents: bigint;
  idempotencyKey: string;
  externalRef?: string;
  description?: string;
  /** Em POST e VOID: a transacao PENDING sendo resolvida. */
  pendingTransactionId?: string;
  effectiveAt: Date;
  postedAt?: Date;
  voidedAt?: Date;
  metadata: Record<string, unknown>;
}

export interface PostTransactionInput {
  id?: string;
  type: LedgerTransactionType;
  /** PENDING reserva; POSTED efetiva imediatamente. */
  phase: EntryPhase.PENDING | EntryPhase.POSTED;
  idempotencyKey: string;
  entries: readonly LedgerEntryInput[];
  currency?: CurrencyCode;
  externalRef?: string;
  description?: string;
  effectiveAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface PostTransactionResult {
  transaction: LedgerTransaction;
  entries: LedgerEntry[];
  /** True quando a chave de idempotencia ja existia e isto e um replay. */
  replayed: boolean;
}

export interface Balances {
  /** creditsPosted - debitsPosted, com sinal ajustado ao normalBalance. */
  posted: bigint;
  /** Posted menos o que ja esta reservado. E o que autoriza um debito. */
  available: bigint;
  /** Creditos ainda nao efetivados. */
  pending: bigint;
}
