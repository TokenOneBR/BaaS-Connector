import { isValidTxid, PixChargeKind, PixChargeStatus } from '@baasconn/taxonomy';
import { z } from 'zod';

import { zPaginationQuery } from '../common/pagination.js';
import { zEnum, zMetadata, zMoney, zTaxId, zTimestamp } from '../common/primitives.js';

const zDecimalString = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/);

const baseCharge = {
  pix_key_id: z.string(),
  amount: zMoney.optional(),
  /** modalidadeAlteracao do BACEN: o pagador pode mudar o valor. */
  amount_is_changeable: z.boolean().default(false),
  payer: z
    .object({
      tax_id: zTaxId,
      name: z.string().min(1).max(255),
    })
    .optional(),
  /** solicitacaoPagador, limitado a 140 caracteres pela spec. */
  payer_request: z.string().max(140).optional(),
  additional_info: z
    .array(z.object({ name: z.string().max(50), value: z.string().max(200) }))
    .max(50)
    .default([]),
  external_id: z.string().max(128).optional(),
  metadata: zMetadata,
};

/**
 * Cobranca.
 *
 * A distincao cob (imediata) / cobv (com vencimento) do BACEN e mantida em vez
 * de achatada: so cobv tem juros, multa e desconto.
 */
export const zCreateCharge = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal(PixChargeKind.STATIC),
    ...baseCharge,
    txid: z
      .string()
      .refine((v) => isValidTxid(v, 'static'), 'txid estatico aceita ate 25 alfanumericos ou ***')
      .optional(),
  }),
  z.object({
    kind: z.literal(PixChargeKind.DYNAMIC_IMMEDIATE),
    ...baseCharge,
    expires_in_seconds: z.number().int().min(60).max(2_592_000).default(3600),
  }),
  z.object({
    kind: z.literal(PixChargeKind.DYNAMIC_DUE),
    ...baseCharge,
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    valid_after_due_days: z.number().int().min(0).max(365).default(0),
    fine: z.object({ mode: z.enum(['FIXED', 'PERCENT']), value: zDecimalString }).optional(),
    interest: z
      .object({
        mode: z.enum(['FIXED_DAILY', 'PERCENT_DAILY', 'PERCENT_MONTHLY', 'PERCENT_YEARLY']),
        value: zDecimalString,
      })
      .optional(),
    discounts: z
      .array(
        z.object({
          mode: z.enum(['FIXED', 'PERCENT']),
          value: zDecimalString,
          date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
        }),
      )
      .max(3)
      .default([]),
  }),
]);

export type CreateChargeDto = z.infer<typeof zCreateCharge>;

export const zPixCharge = z.object({
  id: z.string(),
  object: z.literal('pix_charge').default('pix_charge'),
  account_id: z.string(),
  kind: zEnum(PixChargeKind),
  txid: z.string(),
  status: zEnum(PixChargeStatus),
  /** `revisao` do BACEN: incrementa a cada alteracao da cobranca. */
  revision: z.number().int().nonnegative(),
  amount: zMoney.nullish(),
  amount_is_changeable: z.boolean(),
  /** Payload copia-e-cola (BR Code / EMV MPM). */
  emv_payload: z.string(),
  qr_code_image_url: z.string().nullish(),
  location_url: z.string().nullish(),
  expires_at: zTimestamp.nullish(),
  due_date: z.string().nullish(),
  paid_amount: zMoney.nullish(),
  paid_at: zTimestamp.nullish(),
  paid_transaction_ids: z.array(z.string()).default([]),
  external_id: z.string().nullish(),
  created_at: zTimestamp,
  updated_at: zTimestamp,
});

export type PixChargeDto = z.infer<typeof zPixCharge>;

export const zListChargesQuery = zPaginationQuery.extend({
  status: zEnum(PixChargeStatus).optional(),
  kind: zEnum(PixChargeKind).optional(),
  created_after: z.string().optional(),
  created_before: z.string().optional(),
});

export const zUpdateCharge = z.object({
  amount: zMoney.optional(),
  expires_in_seconds: z.number().int().min(60).max(2_592_000).optional(),
  payer_request: z.string().max(140).optional(),
});
