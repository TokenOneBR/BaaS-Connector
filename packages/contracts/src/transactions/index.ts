import {
  BaasErrorCode,
  ProviderSlug,
  StatementEntryType,
  TransactionDirection,
  TransactionStatus,
  TransactionType,
} from '@baasconn/taxonomy';
import { z } from 'zod';

import { zPaginationQuery } from '../common/pagination.js';
import { zEffectiveDate, zEnum, zMoney, zTimestamp } from '../common/primitives.js';
import { zPixDetail } from '../pix/transfers.js';

export const zTransactionStatusChange = z.object({
  from_status: zEnum(TransactionStatus).nullish(),
  to_status: zEnum(TransactionStatus),
  reason_code: z.string().nullish(),
  reason_message: z.string().nullish(),
  /** De onde veio a mudanca: essencial para depurar um webhook perdido. */
  source: z.string(),
  occurred_at: zTimestamp,
});

export const zTransaction = z.object({
  id: z.string(),
  object: z.literal('transaction').default('transaction'),
  account_id: z.string(),
  type: zEnum(TransactionType),
  direction: zEnum(TransactionDirection),
  status: zEnum(TransactionStatus),
  /** Bruto, sempre positivo. O sinal vive em `direction`. */
  amount: zMoney,
  fee: zMoney,
  /** DEBIT: amount + fee sai. CREDIT: amount - fee entra. */
  net_amount: zMoney,
  refunded_amount: zMoney,
  description: z.string().nullish(),
  provider: zEnum(ProviderSlug),
  provider_transaction_id: z.string().nullish(),
  external_id: z.string().nullish(),
  charge_id: z.string().nullish(),
  parent_transaction_id: z.string().nullish(),
  pix: zPixDetail.nullish(),
  failure: z
    .object({
      code: zEnum(BaasErrorCode),
      provider_code: z.string().nullish(),
      message: z.string(),
    })
    .nullish(),
  effective_date: zEffectiveDate,
  created_at: zTimestamp,
  settled_at: zTimestamp.nullish(),
  failed_at: zTimestamp.nullish(),
  status_history: z.array(zTransactionStatusChange).optional(),
  metadata: z.record(z.string(), z.string()),
});

export type TransactionDto = z.infer<typeof zTransaction>;

export const zListTransactionsQuery = zPaginationQuery.extend({
  status: zEnum(TransactionStatus).optional(),
  type: zEnum(TransactionType).optional(),
  direction: zEnum(TransactionDirection).optional(),
  account_id: z.string().optional(),
  end_to_end_id: z.string().optional(),
  external_id: z.string().optional(),
  idempotency_key: z.string().optional(),
  min_amount: z.string().regex(/^\d+$/).optional(),
  max_amount: z.string().regex(/^\d+$/).optional(),
  effective_date_from: zEffectiveDate.optional(),
  effective_date_to: zEffectiveDate.optional(),
});

export const zStatementEntry = z.object({
  id: z.string(),
  posted_at: zTimestamp,
  effective_date: zEffectiveDate,
  direction: zEnum(TransactionDirection),
  amount: zMoney,
  balance_after: zMoney.nullish(),
  type: zEnum(StatementEntryType),
  end_to_end_id: z.string().nullish(),
  transaction_id: z.string().nullish(),
  counterparty_name: z.string().nullish(),
  description: z.string().nullish(),
});

export const zStatementQuery = zPaginationQuery
  .extend({
    from: zEffectiveDate,
    to: zEffectiveDate,
    direction: zEnum(TransactionDirection).optional(),
    type: zEnum(StatementEntryType).optional(),
  })
  .refine((q) => q.from <= q.to, { message: 'from deve ser anterior ou igual a to' });

/**
 * Status de uma operacao assincrona.
 *
 * Devolvido com 202 quando um PIX out entra em desfecho desconhecido: o
 * cliente consulta aqui em vez de retentar, que e o que evita pagamento duplo.
 */
export const zOperation = z.object({
  id: z.string(),
  object: z.literal('operation').default('operation'),
  kind: z.string(),
  status: z.enum(['PENDING', 'SUBMITTED', 'UNKNOWN', 'SETTLED', 'FAILED']),
  transaction_id: z.string().nullish(),
  end_to_end_id: z.string().nullish(),
  attempts: z.number().int().nonnegative(),
  last_error: z.string().nullish(),
  created_at: zTimestamp,
  updated_at: zTimestamp,
});
