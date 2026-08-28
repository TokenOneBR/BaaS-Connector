import {
  isValidEndToEndId,
  isValidPixKey,
  PixAccountType,
  PixInitiationMethod,
  PixPurpose,
  PixRefundReasonCode,
} from '@baasconn/taxonomy';
import { z } from 'zod';

import { zEnum, zMetadata, zPositiveMoney, zTaxId, zTimestamp } from '../common/primitives.js';

/**
 * Destino de um PIX out.
 *
 * Uniao discriminada em vez de campos opcionais: com campos opcionais nada
 * impede enviar chave e coordenadas bancarias ao mesmo tempo, e o adapter
 * precisa adivinhar qual vale.
 */
export const zPixDestination = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('pix_key'),
      key: z.string().min(1).max(77),
      key_type: z.string().optional(),
    }),
    z.object({
      kind: z.literal('bank_account'),
      ispb: z.string().length(8),
      branch: z.string().min(1).max(8),
      number: z.string().min(1).max(20),
      check_digit: z.string().max(2).optional(),
      account_type: zEnum(PixAccountType),
      holder: z.object({ tax_id: zTaxId, name: z.string().min(1).max(255) }),
    }),
    z.object({ kind: z.literal('emv'), payload: z.string().min(20) }),
    z.object({ kind: z.literal('qr_code'), txid: z.string(), emv: z.string().min(20) }),
  ])
  // A validacao da chave fica fora da uniao porque discriminatedUnion so
  // aceita objetos crus: um membro com .refine() vira ZodEffects e quebra a
  // discriminacao.
  .superRefine((destination, ctx) => {
    if (destination.kind !== 'pix_key' || !destination.key_type) return;
    if (!isValidPixKey(destination.key_type as never, destination.key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Chave Pix invalida para o tipo informado',
        path: ['key'],
      });
    }
  });

export const zSendPix = z.object({
  amount: zPositiveMoney,
  destination: zPixDestination,
  description: z.string().max(140).optional(),
  purpose: zEnum(PixPurpose).default(PixPurpose.TRANSFER),
  initiation_method: zEnum(PixInitiationMethod).optional(),
  /** Requer a capacidade pix.out.scheduled. */
  scheduled_for: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  external_id: z.string().max(128).optional(),
  metadata: zMetadata,
});

export type SendPixDto = z.infer<typeof zSendPix>;

export const zCounterparty = z.object({
  name: z.string().nullish(),
  /** Mascarado por padrao; completo exige o escopo pii:read. */
  tax_id: z.string().nullish(),
  ispb: z.string().nullish(),
  bank_name: z.string().nullish(),
  branch: z.string().nullish(),
  account_number: z.string().nullish(),
  account_type: zEnum(PixAccountType).nullish(),
});

export const zPixDetail = z.object({
  /**
   * Nulo ate PROCESSING, muitas vezes ate SETTLED: e gerado pelo PSP do
   * pagador. Assumir que existe na criacao e a pegadinha classica.
   */
  end_to_end_id: z
    .string()
    .refine((v) => isValidEndToEndId(v))
    .nullish(),
  return_id: z.string().nullish(),
  original_end_to_end_id: z.string().nullish(),
  txid: z.string().nullish(),
  initiation_method: zEnum(PixInitiationMethod),
  purpose: zEnum(PixPurpose),
  key_type: z.string().nullish(),
  key_value: z.string().nullish(),
  counterparty: zCounterparty.nullish(),
  remittance_info: z.string().nullish(),
  refund_reason_code: zEnum(PixRefundReasonCode).nullish(),
  settlement_at: zTimestamp.nullish(),
});

export const zCreateRefund = z
  .object({
    /** Transacao original a devolver, pelo nosso id ou pelo E2EID. */
    transaction_id: z.string().optional(),
    original_end_to_end_id: z.string().optional(),
    /** Omitido, devolve o valor integral. Devolucoes parciais sao acumulativas. */
    amount: zPositiveMoney.optional(),
    reason_code: zEnum(PixRefundReasonCode),
    description: z.string().max(140).optional(),
    external_id: z.string().max(128).optional(),
  })
  .refine((r) => Boolean(r.transaction_id ?? r.original_end_to_end_id), {
    message: 'Informe transaction_id ou original_end_to_end_id',
  });
