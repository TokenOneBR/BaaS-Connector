import type {
  Counterparty,
  PixKey,
  PixKeyResolution,
  PixTransaction,
} from '@baasconn/provider-spi';
import { PixKeyType, TransactionStatus } from '@baasconn/taxonomy';

import type { CcDictEntry, CcParty, CcPixPayment } from '../dto/index.js';

import { taxIdOf } from './account.js';
import { fromNumber } from './money.js';

const KEY_TYPE: Readonly<Record<string, PixKeyType>> = Object.freeze({
  CPF: PixKeyType.CPF,
  CNPJ: PixKeyType.CNPJ,
  EMAIL: PixKeyType.EMAIL,
  // A Celcoin chama de MAIL o que o BACEN chama de EMAIL. Sem esta linha toda
  // chave de e-mail viraria EVP e o cliente veria o tipo errado no extrato.
  MAIL: PixKeyType.EMAIL,
  PHONE: PixKeyType.PHONE,
  EVP: PixKeyType.EVP,
});

/**
 * Situacao de pagamento para a canonica.
 *
 * O desconhecido vira `UNKNOWN`, JAMAIS `FAILED`. `FAILED` autoriza o cliente
 * a reenviar, e reenviar um pagamento cujo desfecho nao conhecemos e
 * exatamente o erro que custa dinheiro. `UNKNOWN` leva a escada de reconsulta.
 */
const PAYMENT_STATUS: Readonly<Record<string, TransactionStatus>> = Object.freeze({
  PENDING: TransactionStatus.PENDING,
  PROCESSING: TransactionStatus.PROCESSING,
  CONFIRMED: TransactionStatus.SETTLED,
  SETTLED: TransactionStatus.SETTLED,
  SUCCESS: TransactionStatus.SETTLED,
  ERROR: TransactionStatus.FAILED,
  DENIED: TransactionStatus.FAILED,
  CANCELLED: TransactionStatus.CANCELLED,
  CANCELED: TransactionStatus.CANCELLED,
  REFUNDED: TransactionStatus.REVERSED,
});

export function toPixKeyType(raw: string): PixKeyType {
  return KEY_TYPE[raw.toUpperCase()] ?? PixKeyType.EVP;
}

export function toTransactionStatus(raw: string): TransactionStatus {
  return PAYMENT_STATUS[raw.toUpperCase()] ?? TransactionStatus.UNKNOWN;
}

export function toCounterparty(party: CcParty | undefined): Counterparty | undefined {
  if (!party) return undefined;
  return {
    name: party.name,
    taxId: party.taxId ? taxIdOf(party.taxId) : undefined,
    ispb: party.bank,
    branch: party.branch,
    accountNumber: party.account,
  };
}

export function toPixKey(entry: CcDictEntry): PixKey {
  return {
    providerKeyId: entry.key,
    type: toPixKeyType(entry.keyType),
    value: entry.key,
    status: entry.status ?? 'ACTIVE',
    requestedAt: entry.createdAt,
    activatedAt:
      entry.status === undefined || entry.status === 'ACTIVE' ? entry.createdAt : undefined,
    raw: entry,
  };
}

export function toPixKeyResolution(entry: CcDictEntry): PixKeyResolution {
  const document = entry.owner?.taxId ?? entry.owner?.documentNumber ?? '';
  return {
    key: entry.key,
    keyType: toPixKeyType(entry.keyType),
    holderName: entry.owner?.name ?? '',
    holderTaxId: taxIdOf(document),
    ispb: entry.account?.participant ?? '',
    branch: entry.account?.branch,
    accountNumber: entry.account?.account,
    raw: entry,
  };
}

export function toPixTransaction(payment: CcPixPayment, direction: 'in' | 'out'): PixTransaction {
  const status = toTransactionStatus(payment.status);

  return {
    providerTransactionId: String(payment.transactionId ?? payment.id ?? payment.clientCode ?? ''),
    // Nulo ate PROCESSING, muitas vezes ate SETTLED: quem o gera e o PSP do
    // pagador. Assumir que existe na criacao e a pegadinha classica do PIX.
    endToEndId: payment.endToEndId,
    status,
    direction,
    amount: fromNumber(payment.amount ?? 0),
    counterparty: toCounterparty(direction === 'out' ? payment.creditParty : payment.debitParty),
    createdAt: payment.createDate ?? new Date(0).toISOString(),
    settledAt: status === TransactionStatus.SETTLED ? payment.lastUpdate : undefined,
    failure: payment.error?.errorCode
      ? { code: payment.error.errorCode, message: payment.error.message ?? '' }
      : undefined,
    raw: payment,
  };
}
