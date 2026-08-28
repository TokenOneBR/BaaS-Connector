import {
  CompanySize,
  HolderType,
  IdentityDocumentKind,
  MaritalStatus,
  RepresentativeRole,
  RiskRating,
  TaxIdType,
} from '@baasconn/taxonomy';
import { z } from 'zod';

import {
  zAddress,
  zEmail,
  zEnum,
  zExternalId,
  zMetadata,
  zMoney,
  zPhone,
  zTaxId,
  zTimestamp,
} from '../common/primitives.js';

const zIsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato YYYY-MM-DD');

export const zLegalRepresentative = z.object({
  role: zEnum(RepresentativeRole),
  tax_id: zTaxId.refine((t) => t.type === TaxIdType.CPF, {
    message: 'Representante legal e sempre identificado por CPF',
  }),
  full_name: z.string().min(1).max(255),
  birth_date: zIsoDate,
  mother_name: z.string().max(255).optional(),
  email: zEmail.optional(),
  phone: zPhone.optional(),
  /** String decimal, nunca float: participacao societaria entra em calculo. */
  ownership_percentage: z
    .string()
    .regex(/^\d{1,3}(\.\d{1,6})?$/)
    .optional(),
  /** Beneficiario final: >= 25% conforme Circular BCB 3.978. */
  is_ultimate_beneficial_owner: z.boolean().default(false),
  /** Pode movimentar a conta. */
  is_signer: z.boolean().default(false),
  is_politically_exposed: z.boolean().default(false),
  address: zAddress.optional(),
});

export type LegalRepresentativeDto = z.infer<typeof zLegalRepresentative>;

const individualFields = {
  birth_date: zIsoDate,
  mother_name: z.string().max(255).optional(),
  nationality: z.string().length(3).optional(),
  marital_status: zEnum(MaritalStatus).optional(),
  /** Codigo CBO. */
  occupation_code: z.string().max(10).optional(),
  identity_document: z
    .object({
      kind: zEnum(IdentityDocumentKind),
      number: z.string().max(32),
      issuer: z.string().max(32).optional(),
      issued_at: zIsoDate.optional(),
    })
    .optional(),
  monthly_income: zMoney.optional(),
};

const businessFields = {
  trade_name: z.string().max(255).optional(),
  incorporation_date: zIsoDate,
  /** Codigo de natureza juridica da Receita. */
  legal_nature_code: z.string().max(8).optional(),
  main_cnae: z
    .string()
    .regex(/^\d{7}$|^\d{4}-\d\/\d{2}$/)
    .optional(),
  secondary_cnaes: z.array(z.string()).max(50).default([]),
  company_size: zEnum(CompanySize).optional(),
  monthly_revenue: zMoney.optional(),
  share_capital: zMoney.optional(),
  representatives: z.array(zLegalRepresentative).min(1),
};

const sharedFields = {
  legal_name: z.string().min(1).max(255),
  preferred_name: z.string().max(255).optional(),
  email: zEmail,
  phone: zPhone,
  addresses: z.array(zAddress).min(1),
  is_politically_exposed: z.boolean().default(false),
  external_id: zExternalId.optional(),
  metadata: zMetadata,
};

/**
 * Uniao discriminada por `type`.
 *
 * `legal_name` e um campo so para PF e PJ de proposito: todo provedor tem um
 * "nome principal", e bifurcar o modelo dobraria cada mapper sem ganho.
 */
export const zCreateHolder = z.discriminatedUnion('type', [
  z.object({
    type: z.literal(HolderType.INDIVIDUAL),
    tax_id: zTaxId,
    ...sharedFields,
    ...individualFields,
  }),
  z.object({
    type: z.literal(HolderType.BUSINESS),
    tax_id: zTaxId,
    ...sharedFields,
    ...businessFields,
  }),
]);

export type CreateHolderDto = z.infer<typeof zCreateHolder>;

export const zHolder = z.object({
  id: z.string(),
  type: zEnum(HolderType),
  tax_id: z.object({ type: zEnum(TaxIdType), value: z.string() }),
  legal_name: z.string(),
  trade_name: z.string().nullish(),
  email: z.string(),
  risk_rating: zEnum(RiskRating).nullish(),
  external_id: z.string().nullish(),
  created_at: zTimestamp,
  updated_at: zTimestamp,
});

export type HolderDto = z.infer<typeof zHolder>;
