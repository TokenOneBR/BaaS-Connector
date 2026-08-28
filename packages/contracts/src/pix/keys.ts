import { isValidPixKey, PixClaimType, PixKeyStatus, PixKeyType } from '@baasconn/taxonomy';
import { z } from 'zod';

import { zEnum, zTimestamp } from '../common/primitives.js';

export const zCreatePixKey = z
  .object({
    type: zEnum(PixKeyType),
    /** Obrigatorio exceto para EVP, que o PSP gera. */
    value: z.string().max(77).optional(),
  })
  .refine((input) => input.type === PixKeyType.EVP || Boolean(input.value), {
    message: 'value e obrigatorio para chaves que nao sao EVP',
    path: ['value'],
  })
  .refine((input) => !input.value || isValidPixKey(input.type, input.value), {
    message: 'Chave Pix invalida para o tipo informado',
    path: ['value'],
  });

export const zPixKey = z.object({
  id: z.string(),
  object: z.literal('pix_key').default('pix_key'),
  account_id: z.string(),
  type: zEnum(PixKeyType),
  value: z.string(),
  status: zEnum(PixKeyStatus),
  claim: z
    .object({
      type: zEnum(PixClaimType),
      status: z.string(),
      resolution_due_at: zTimestamp.nullish(),
      claimant_ispb: z.string().nullish(),
    })
    .nullish(),
  requested_at: zTimestamp,
  activated_at: zTimestamp.nullish(),
  removed_at: zTimestamp.nullish(),
});

export type PixKeyDto = z.infer<typeof zPixKey>;

/** Consulta DICT de chave de terceiro, para pre-visualizar um destino. */
export const zResolvePixKeyQuery = z.object({ key: z.string().min(1).max(77) });

export const zPixKeyResolution = z.object({
  key: z.string(),
  key_type: zEnum(PixKeyType),
  holder_name: z.string(),
  /** Sempre mascarado: e documento de terceiro. */
  holder_tax_id: z.string(),
  ispb: z.string(),
  bank_name: z.string().nullish(),
  branch: z.string().nullish(),
  account_number: z.string().nullish(),
  account_type: z.string().nullish(),
  /** Consulta DICT e informativa: nunca autoriza sozinha um pagamento. */
  resolved_at: zTimestamp,
});
