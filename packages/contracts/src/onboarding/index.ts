import {
  DocumentSide,
  DocumentStatus,
  OnboardingDecision,
  OnboardingRejectionCode,
  OnboardingStatus,
  OnboardingType,
  RequirementCode,
  RequirementStatus,
  ScreeningResult,
  ScreeningType,
} from '@baasconn/taxonomy';
import { z } from 'zod';

import { zEnum, zMetadata, zTaxId, zTimestamp } from '../common/primitives.js';

export const zSubmitOnboarding = z.object({
  /** Omitido, deduzido do tipo do titular da conta. */
  type: zEnum(OnboardingType).optional(),
  /** Aceite de termos, exigido pela maioria dos provedores. */
  terms_accepted: z.boolean().default(false),
  terms_accepted_at: zTimestamp.optional(),
  terms_accepted_ip: z.string().optional(),
  metadata: zMetadata,
});

/**
 * Pendencia de onboarding.
 *
 * A lista e declarativa e reconciliada de forma idempotente: a cada evento do
 * provedor o adapter emite o conjunto completo e o core faz diff. Sem isso, a
 * lista vira append-only e nunca limpa, que e a falha classica.
 */
export const zRequirement = z.object({
  id: z.string(),
  code: zEnum(RequirementCode),
  /** Para REPRESENTATIVE_KYC: de qual socio a pendencia trata. */
  subject_representative_id: z.string().nullish(),
  status: zEnum(RequirementStatus),
  label: z.string(),
  description: z.string().nullish(),
  document_id: z.string().nullish(),
  rejection_code: zEnum(OnboardingRejectionCode).nullish(),
  rejection_message: z.string().nullish(),
  attempts: z.number().int().nonnegative(),
  due_at: zTimestamp.nullish(),
});

export type RequirementDto = z.infer<typeof zRequirement>;

export const zScreening = z.object({
  id: z.string(),
  subject_type: z.enum(['HOLDER', 'REPRESENTATIVE']),
  subject_id: z.string(),
  type: zEnum(ScreeningType),
  source: z.string(),
  result: zEnum(ScreeningResult),
  score: z.string().nullish(),
  matches: z
    .array(
      z.object({
        list_name: z.string(),
        matched_name: z.string(),
        similarity: z.string().nullish(),
      }),
    )
    .default([]),
  screened_at: zTimestamp,
  next_due_at: zTimestamp.nullish(),
});

export const zOnboardingCase = z.object({
  id: z.string(),
  object: z.literal('onboarding').default('onboarding'),
  account_id: z.string().nullish(),
  holder_id: z.string(),
  /** KYB fanout: cada representante obrigatorio vira um caso KYC filho. */
  parent_case_id: z.string().nullish(),
  type: zEnum(OnboardingType),
  status: zEnum(OnboardingStatus),
  decision: zEnum(OnboardingDecision).nullish(),
  rejection_code: zEnum(OnboardingRejectionCode).nullish(),
  rejection_message: z.string().nullish(),
  provider_rejection_code: z.string().nullish(),
  risk_score: z.string().nullish(),
  requirements: z.array(zRequirement).default([]),
  screenings: z.array(zScreening).default([]),
  submitted_at: zTimestamp.nullish(),
  decided_at: zTimestamp.nullish(),
  expires_at: zTimestamp.nullish(),
  created_at: zTimestamp,
  updated_at: zTimestamp,
});

export type OnboardingCaseDto = z.infer<typeof zOnboardingCase>;

export const zUploadDocumentMeta = z.object({
  kind: zEnum(RequirementCode),
  side: zEnum(DocumentSide).default(DocumentSide.SINGLE),
  subject_representative_id: z.string().optional(),
  requirement_id: z.string().optional(),
});

export const zDocument = z.object({
  id: z.string(),
  kind: zEnum(RequirementCode),
  side: zEnum(DocumentSide),
  content_type: z.string(),
  size_bytes: z.number().int().positive(),
  sha256: z.string().length(64),
  status: zEnum(DocumentStatus),
  uploaded_at: zTimestamp,
});

export const zFulfillRequirement = z.object({
  document_id: z.string().optional(),
  /** Para ADDITIONAL_INFORMATION e correcao de campo. */
  data: z.record(z.string(), z.unknown()).optional(),
});

export const zPldScreeningRequest = z.object({
  subject_tax_id: zTaxId,
  subject_name: z.string().min(1).max(255),
  types: z.array(zEnum(ScreeningType)).min(1),
});
