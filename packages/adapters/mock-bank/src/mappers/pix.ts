import type {
  Counterparty,
  PixCharge,
  PixKey,
  PixKeyResolution,
  PixRefund,
  PixTransaction,
  StatementEntry,
} from '@baasconn/provider-spi';
import {
  PixChargeStatus,
  PixKeyType,
  TransactionStatus,
  toEffectiveDate,
} from '@baasconn/taxonomy';
import { StatementEntryType } from '@baasconn/taxonomy';

import type { MbCharge, MbCounterparty, MbDictEntry, MbPayment, MbPixKey } from '../dto/index.js';

import { taxIdOf } from './account.js';
import { fromDecimal, optionalDecimal } from './money.js';

export function toPixKeyType(tipo: string): PixKeyType {
  return tipo in PixKeyType ? PixKeyType[tipo as keyof typeof PixKeyType] : PixKeyType.EVP;
}

export function toTransactionStatus(situacao: string): TransactionStatus {
  // Um status que nao reconhecemos e UNKNOWN, jamais FAILED: FAILED autoriza o
  // cliente a reenviar, e reenviar um pagamento cujo desfecho nao conhecemos e
  // exatamente o erro que custa dinheiro.
  return situacao in TransactionStatus
    ? TransactionStatus[situacao as keyof typeof TransactionStatus]
    : TransactionStatus.UNKNOWN;
}

export function toCounterparty(raw: MbCounterparty | null | undefined): Counterparty | undefined {
  if (!raw) return undefined;
  return {
    name: raw.name,
    taxId: raw.taxId ? taxIdOf(raw.taxId) : undefined,
    ispb: raw.ispb,
    branch: raw.branch,
    accountNumber: raw.accountNumber,
  };
}

export function toPixKey(key: MbPixKey): PixKey {
  return {
    providerKeyId: key.id,
    type: toPixKeyType(key.tipo),
    value: key.chave,
    status: key.situacao,
    requestedAt: key.criada_em,
    activatedAt: key.situacao === 'ACTIVE' ? key.criada_em : undefined,
    raw: key,
  };
}

export function toPixKeyResolution(entry: MbDictEntry): PixKeyResolution {
  return {
    key: entry.chave,
    keyType: toPixKeyType(entry.tipo),
    holderName: entry.nome_titular,
    holderTaxId: taxIdOf(entry.documento_titular),
    ispb: entry.ispb,
    branch: entry.agencia,
    accountNumber: entry.conta,
    raw: entry,
  };
}

export function toPixCharge(charge: MbCharge): PixCharge {
  return {
    txid: charge.txid,
    kind: charge.tipo === 'DINAMICA' ? 'dynamic' : 'static',
    status:
      charge.situacao in PixChargeStatus
        ? PixChargeStatus[charge.situacao as keyof typeof PixChargeStatus]
        : PixChargeStatus.ACTIVE,
    amount: optionalDecimal(charge.valor),
    emvPayload: charge.emv,
    revision: charge.revisao,
    expiresAt: charge.expira_em ?? undefined,
    paidAmount: optionalDecimal(charge.valor_pago),
    paidAt: charge.pago_em ?? undefined,
    raw: charge,
  };
}

export function toPixTransaction(payment: MbPayment): PixTransaction {
  return {
    providerTransactionId: payment.id,
    // Nulo ate PROCESSING: e o PSP do pagador que o cunha. Assumir que existe
    // na criacao e a pegadinha classica do PIX.
    endToEndId: payment.end_to_end_id ?? undefined,
    status: toTransactionStatus(payment.situacao),
    direction: payment.tipo === 'CREDITO' ? 'in' : 'out',
    amount: fromDecimal(payment.valor),
    fee: optionalDecimal(payment.tarifa),
    counterparty: toCounterparty(payment.contraparte),
    txid: payment.txid ?? undefined,
    createdAt: payment.data_movimento,
    settledAt: payment.data_liquidacao ?? undefined,
    raw: payment,
  };
}

export function toPixRefund(payment: MbPayment): PixRefund {
  return {
    providerRefundId: payment.id,
    returnId: payment.id_devolucao ?? undefined,
    originalEndToEndId: payment.end_to_end_id_original ?? '',
    status: toTransactionStatus(payment.situacao),
    amount: fromDecimal(payment.valor),
    createdAt: payment.data_movimento,
    settledAt: payment.data_liquidacao ?? undefined,
    raw: payment,
  };
}

function entryTypeOf(payment: MbPayment): StatementEntryType {
  // `categoria` quando o provedor a manda; o fallback pelo `id_devolucao`
  // continua porque nem toda rota do Mock Bank a carrega.
  const categoria = (payment as { categoria?: string }).categoria;
  if (categoria === 'TARIFA') return StatementEntryType.FEE;
  if (categoria === 'DEVOLUCAO' || payment.id_devolucao) return StatementEntryType.REFUND;
  return payment.tipo === 'CREDITO' ? StatementEntryType.PIX_IN : StatementEntryType.PIX_OUT;
}

export function toStatementEntry(payment: MbPayment): StatementEntry {
  const postedAt = payment.data_liquidacao ?? payment.data_movimento;
  return {
    providerEntryId: payment.id,
    postedAt,
    // Dia bancario brasileiro, nao UTC: um PIX das 22h em Sao Paulo cai no dia
    // seguinte em UTC, e o extrato do cliente diria a data errada.
    effectiveDate: toEffectiveDate(new Date(postedAt)),
    direction: payment.tipo === 'CREDITO' ? 'credit' : 'debit',
    amount: fromDecimal(payment.valor),
    type: entryTypeOf(payment),
    endToEndId: payment.end_to_end_id ?? undefined,
    providerTransactionId: payment.id,
    counterparty: toCounterparty(payment.contraparte),
    description: payment.descricao ?? undefined,
    raw: payment,
  };
}
