import { AccountKind, AccountStatus, HolderType, ProviderSlug } from '@baasconn/taxonomy';
import { z } from 'zod';

import { zFreshness, zPaginationQuery } from '../common/pagination.js';
import { zEnum, zExternalId, zMetadata, zMoney, zTimestamp } from '../common/primitives.js';

import { zCreateHolder } from './holder.js';

export const zCreateAccount = z.object({
  holder: zCreateHolder,
  kind: zEnum(AccountKind).default(AccountKind.PAYMENT),
  /** Conexao de provedor a usar; omitida, cai na conexao padrao da chave. */
  connection_id: z.string().optional(),
  external_id: zExternalId.optional(),
  metadata: zMetadata,
});

export type CreateAccountDto = z.infer<typeof zCreateAccount>;

export const zBankCoordinates = z.object({
  ispb: z.string().length(8),
  bank_code: z.string().length(3).nullish(),
  branch: z.string(),
  branch_check_digit: z.string().nullish(),
  number: z.string(),
  check_digit: z.string().nullish(),
});

export const zAccount = z.object({
  id: z.string(),
  object: z.literal('account').default('account'),
  holder_id: z.string(),
  holder_type: zEnum(HolderType),
  /** Mascarado por padrao; completo exige o escopo pii:read. */
  holder_tax_id: z.string(),
  holder_name: z.string(),
  provider: zEnum(ProviderSlug),
  connection_id: z.string(),
  provider_account_id: z.string().nullish(),
  external_id: z.string().nullish(),
  status: zEnum(AccountStatus),
  status_reason: z.object({ code: z.string(), message: z.string(), at: zTimestamp }).nullish(),
  kind: zEnum(AccountKind),
  currency: z.literal('BRL'),
  bank: zBankCoordinates.nullish(),
  opened_at: zTimestamp.nullish(),
  closed_at: zTimestamp.nullish(),
  metadata: z.record(z.string(), z.string()),
  created_at: zTimestamp,
  updated_at: zTimestamp,
});

export type AccountDto = z.infer<typeof zAccount>;

export const zListAccountsQuery = zPaginationQuery.extend({
  status: zEnum(AccountStatus).optional(),
  holder_type: zEnum(HolderType).optional(),
  provider: zEnum(ProviderSlug).optional(),
  external_id: z.string().optional(),
  /** Busca por nome ou documento. */
  q: z.string().max(128).optional(),
  created_after: z.string().optional(),
  created_before: z.string().optional(),
});

export const zUpdateAccountStatus = z.object({
  reason_code: z.string().max(64).optional(),
  reason: z.string().max(512).optional(),
});

export const zCloseAccount = z.object({
  reason: z.string().max(512),
  /** Conta para onde drenar o saldo remanescente, se houver. */
  transfer_remaining_to_pix_key: z.string().optional(),
});

/**
 * Saldo.
 *
 * `total = available + blocked + pending`, calculado num unico lugar.
 * `_meta.freshness` e obrigatorio: e o que torna seguro servir do cache
 * por padrao.
 */
export const zBalance = z.object({
  object: z.literal('balance').default('balance'),
  account_id: z.string(),
  currency: z.literal('BRL'),
  available: zMoney,
  blocked: zMoney,
  pending: zMoney,
  total: zMoney,
  /** PIX out autorizado e ainda nao liquidado. */
  scheduled_outflow: zMoney.nullish(),
  _meta: z.object({ request_id: z.string(), freshness: zFreshness }),
});

export type BalanceDto = z.infer<typeof zBalance>;

export const zBalanceQuery = z.object({
  consistency: z.enum(['cached', 'strong']).default('cached'),
  /** Fonte alternativa: o ledger sombra do conector, para auditoria. */
  source: z.enum(['provider', 'ledger']).default('provider'),
  on_provider_error: z.enum(['fail', 'serve_stale']).default('fail'),
});
