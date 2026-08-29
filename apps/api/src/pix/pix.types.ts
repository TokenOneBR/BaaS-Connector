import type {
  Environment,
  PixChargeKind,
  PixChargeStatus,
  PixInitiationMethod,
  PixKeyStatus,
  PixKeyType,
  PixPurpose,
  TransactionDirection,
  TransactionStatus,
  TransactionType,
} from '@baasconn/taxonomy';

import type { StatusChangeResult } from '../accounts/accounts.types.js';

export const TRANSACTION_REPOSITORY = Symbol('BAAS_TRANSACTION_REPOSITORY');
export const PIX_KEY_REPOSITORY = Symbol('BAAS_PIX_KEY_REPOSITORY');
export const PIX_CHARGE_REPOSITORY = Symbol('BAAS_PIX_CHARGE_REPOSITORY');
export const OPERATION_REPOSITORY = Symbol('BAAS_OPERATION_REPOSITORY');

export interface CounterpartyRecord {
  name?: string | null;
  taxIdLast4?: string | null;
  taxIdIndex?: string | null;
  ispb?: string | null;
  branch?: string | null;
  accountNumber?: string | null;
}

export interface TransactionRecord {
  id: string;
  environment: Environment;
  accountId: string;
  chargeId?: string | null;
  parentTransactionId?: string | null;
  type: TransactionType;
  direction: TransactionDirection;
  status: TransactionStatus;
  /** Base do guard monotonico, igual ao de conta e onboarding. */
  lastEventAt?: Date | null;
  amountCents: bigint;
  feeCents: bigint;
  netAmountCents: bigint;
  refundedAmountCents: bigint;
  currency: string;
  description?: string | null;
  provider: string;
  providerConnectionId: string;
  providerTransactionId?: string | null;
  externalId?: string | null;
  idempotencyKey?: string | null;
  operationId?: string | null;
  failureCode?: string | null;
  providerFailureCode?: string | null;
  failureMessage?: string | null;
  effectiveDate: string;
  requestedAt: Date;
  settledAt?: Date | null;
  failedAt?: Date | null;
  /** Ligacao com o razao sombra: a reserva e a sua resolucao. */
  ledgerPendingTransactionId?: string | null;
  ledgerPostedTransactionId?: string | null;
  pix?: PixDetailRecord | null;
  metadata: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

export interface PixDetailRecord {
  endToEndId?: string | null;
  returnId?: string | null;
  originalEndToEndId?: string | null;
  txid?: string | null;
  initiationMethod: PixInitiationMethod;
  purpose: PixPurpose;
  keyType?: PixKeyType | null;
  keyValue?: string | null;
  counterparty?: CounterpartyRecord | null;
  remittanceInfo?: string | null;
  settlementAt?: Date | null;
}

export interface ListTransactionsFilter {
  environment: Environment;
  accountId?: string;
  status?: TransactionStatus;
  direction?: TransactionDirection;
  endToEndId?: string;
  limit: number;
  cursor?: string;
}

/** Posicao do keyset: o par que o `ORDER BY (effective_date desc, id desc)` usa. */
export interface StatementPosition {
  date: string;
  id: string;
}

export interface StatementFilter {
  environment: Environment;
  accountId: string;
  from: string;
  to: string;
  /**
   * Estados que pertencem ao extrato.
   *
   * Vem do servico, e nao esta embutido no repositorio: e politica de dominio
   * ("o que ja aconteceu"), e as duas implementacoes precisam obedecer a
   * MESMA lista, nao a duas copias que divergem.
   */
  statuses: readonly TransactionStatus[];
  limit: number;
  /**
   * Ja decodificado e verificado.
   *
   * O repositorio recebe a POSICAO, nao o cursor assinado: assinar e conferir
   * exige a chave da aplicacao, que e assunto do servico. Um repositorio que
   * conhecesse o segredo seria um lugar a mais de onde ele pode vazar.
   */
  cursor?: StatementPosition;
}

export interface TransactionRepository {
  findById(environment: Environment, id: string): Promise<TransactionRecord | undefined>;
  findByProviderTransactionId(
    environment: Environment,
    provider: string,
    providerTransactionId: string,
  ): Promise<TransactionRecord | undefined>;
  findByEndToEndId(
    environment: Environment,
    endToEndId: string,
  ): Promise<TransactionRecord | undefined>;
  findByIdempotencyKey(
    environment: Environment,
    idempotencyKey: string,
  ): Promise<TransactionRecord | undefined>;
  create(record: TransactionRecord): Promise<TransactionRecord>;
  list(filter: ListTransactionsFilter): Promise<{ data: TransactionRecord[]; nextCursor?: string }>;
  statement(
    filter: StatementFilter,
  ): Promise<{ data: TransactionRecord[]; nextCursor?: StatementPosition }>;
  /**
   * Muda o status sob lock, com o guard monotonico.
   *
   * Mesmo contrato de conta e onboarding: a decisao e do repositorio, dentro
   * da transacao que trava a linha, porque decidir fora e gravar depois e uma
   * corrida.
   */
  applyStatusChange(input: {
    environment: Environment;
    transactionId: string;
    toStatus: TransactionStatus;
    failureCode?: string;
    providerFailureCode?: string;
    failureMessage?: string;
    endToEndId?: string;
    settledAt?: Date;
    ledgerPostedTransactionId?: string;
    occurredAt: Date;
    source: string;
    providerEventId?: string;
    withinTransaction?: (transactionId: string) => Promise<void>;
  }): Promise<StatusChangeResult<TransactionRecord>>;
  attachProviderTransaction(input: {
    environment: Environment;
    transactionId: string;
    providerTransactionId: string;
    endToEndId?: string;
    status: TransactionStatus;
  }): Promise<TransactionRecord>;
}

export interface PixKeyRecord {
  id: string;
  environment: Environment;
  accountId: string;
  type: PixKeyType;
  value: string;
  valueBlindIndex: string;
  status: PixKeyStatus;
  providerKeyId?: string | null;
  requestedAt: Date;
  activatedAt?: Date | null;
  removedAt?: Date | null;
}

export interface PixKeyRepository {
  findById(environment: Environment, id: string): Promise<PixKeyRecord | undefined>;
  listByAccount(environment: Environment, accountId: string): Promise<PixKeyRecord[]>;
  findActiveByBlindIndex(
    environment: Environment,
    blindIndex: string,
  ): Promise<PixKeyRecord | undefined>;
  create(record: PixKeyRecord): Promise<PixKeyRecord>;
  markRemoved(environment: Environment, id: string, at: Date): Promise<void>;
}

export interface PixChargeRecord {
  id: string;
  environment: Environment;
  accountId: string;
  pixKeyId: string;
  kind: PixChargeKind;
  txid: string;
  status: PixChargeStatus;
  revision: number;
  amountCents?: bigint | null;
  paidAmountCents: bigint;
  amountIsChangeable: boolean;
  currency: string;
  expiresAt?: Date | null;
  emvPayload: string;
  provider: string;
  providerChargeId?: string | null;
  externalId?: string | null;
  paidAt?: Date | null;
  lastEventAt?: Date | null;
  metadata: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

export interface PixChargeRepository {
  findByTxid(environment: Environment, txid: string): Promise<PixChargeRecord | undefined>;
  listByAccount(
    environment: Environment,
    accountId: string,
    limit: number,
  ): Promise<PixChargeRecord[]>;
  create(record: PixChargeRecord): Promise<PixChargeRecord>;
  applyStatusChange(input: {
    environment: Environment;
    txid: string;
    toStatus: PixChargeStatus;
    paidAmountCents?: bigint;
    paidAt?: Date;
    occurredAt: Date;
    withinTransaction?: (chargeId: string) => Promise<void>;
  }): Promise<StatusChangeResult<PixChargeRecord>>;
}

export type OperationStatusValue = 'PENDING' | 'SUBMITTED' | 'UNKNOWN' | 'SETTLED' | 'FAILED';

export interface OperationRecord {
  id: string;
  environment: Environment;
  connectionId: string;
  kind: string;
  providerIdempotencyKey: string;
  status: OperationStatusValue;
  requestDigest: string;
  providerRef?: string | null;
  endToEndId?: string | null;
  amountCents?: bigint | null;
  accountId?: string | null;
  attempts: number;
  lastError?: Record<string, unknown> | null;
  nextTryAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Operacoes contra o provedor.
 *
 * Existe para o desfecho DESCONHECIDO ter onde morar: quando um POST que move
 * dinheiro nao responde, a operacao fica registrada em UNKNOWN e a conciliacao
 * a resolve consultando o provedor pela NOSSA chave. Nunca reenviando.
 */
export interface OperationRepository {
  findById(environment: Environment, id: string): Promise<OperationRecord | undefined>;
  create(record: OperationRecord): Promise<OperationRecord>;
  update(input: {
    environment: Environment;
    id: string;
    status?: OperationStatusValue;
    providerRef?: string;
    endToEndId?: string;
    lastError?: Record<string, unknown>;
    incrementAttempts?: boolean;
  }): Promise<OperationRecord | undefined>;
  findStuck(environment: Environment, limit: number): Promise<OperationRecord[]>;
}
