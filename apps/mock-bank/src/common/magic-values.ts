import { OnboardingRejectionCode, RequirementCode, ScreeningType } from '@baasconn/taxonomy';

/**
 * Valores magicos deterministicos.
 *
 * Padrao dos cartoes de teste da Stripe: o comportamento e funcao PURA do
 * documento ou do valor, entao um teste nunca precisa mexer em estado do
 * servidor para chegar a um cenario. Isso e o que torna a suite e2e legivel:
 * "CNPJ terminado em 01" diz sozinho o que vai acontecer.
 */

export enum OnboardingScenario {
  /** Recusa imediata por divergencia com a Receita. */
  REJECT_DATA_MISMATCH = 'REJECT_DATA_MISMATCH',
  /** Pede selfie e comprovante; aprova quando os dois chegam. */
  PENDING_DOCUMENTS = 'PENDING_DOCUMENTS',
  /** Vai para mesa de analise e aprova apos o atraso configurado. */
  MANUAL_REVIEW = 'MANUAL_REVIEW',
  /** Screening de sancoes casa: recusa. */
  SANCTIONS_MATCH = 'SANCTIONS_MATCH',
  /** Screening PEP casa: vai para analise manual. */
  PEP_MATCH = 'PEP_MATCH',
  /** Expira em 60 segundos sem documento. */
  EXPIRES = 'EXPIRES',
  /** Aprova, mas a conta abre bloqueada. */
  APPROVE_BLOCKED = 'APPROVE_BLOCKED',
  /** Caminho feliz. */
  APPROVE = 'APPROVE',
}

const ONBOARDING_BY_SUFFIX: Readonly<Record<string, OnboardingScenario>> = Object.freeze({
  '00': OnboardingScenario.REJECT_DATA_MISMATCH,
  '01': OnboardingScenario.PENDING_DOCUMENTS,
  '02': OnboardingScenario.MANUAL_REVIEW,
  '03': OnboardingScenario.SANCTIONS_MATCH,
  '04': OnboardingScenario.PEP_MATCH,
  '05': OnboardingScenario.EXPIRES,
  '06': OnboardingScenario.APPROVE_BLOCKED,
});

/** Deriva o cenario dos dois ultimos digitos do documento. */
export function onboardingScenarioFor(taxId: string): OnboardingScenario {
  const digits = taxId.replace(/\D/g, '');
  return ONBOARDING_BY_SUFFIX[digits.slice(-2)] ?? OnboardingScenario.APPROVE;
}

export interface ScenarioOutcome {
  requirements: RequirementCode[];
  screenings: Array<{ type: ScreeningType; matched: boolean }>;
  rejectionCode?: OnboardingRejectionCode;
  /** Depois de aprovado, a conta abre bloqueada. */
  openBlocked: boolean;
  expiresInSeconds?: number;
}

export function describeOnboardingScenario(scenario: OnboardingScenario): ScenarioOutcome {
  switch (scenario) {
    case OnboardingScenario.REJECT_DATA_MISMATCH:
      return {
        requirements: [],
        screenings: [],
        rejectionCode: OnboardingRejectionCode.DATA_MISMATCH,
        openBlocked: false,
      };
    case OnboardingScenario.PENDING_DOCUMENTS:
      return {
        requirements: [RequirementCode.SELFIE_LIVENESS, RequirementCode.PROOF_OF_ADDRESS],
        screenings: [],
        openBlocked: false,
      };
    case OnboardingScenario.MANUAL_REVIEW:
      return { requirements: [], screenings: [], openBlocked: false };
    case OnboardingScenario.SANCTIONS_MATCH:
      return {
        requirements: [],
        screenings: [{ type: ScreeningType.SANCTIONS, matched: true }],
        rejectionCode: OnboardingRejectionCode.SANCTIONS_MATCH,
        openBlocked: false,
      };
    case OnboardingScenario.PEP_MATCH:
      return {
        requirements: [],
        screenings: [{ type: ScreeningType.PEP, matched: true }],
        openBlocked: false,
      };
    case OnboardingScenario.EXPIRES:
      return {
        requirements: [RequirementCode.IDENTITY_FRONT],
        screenings: [],
        openBlocked: false,
        expiresInSeconds: 60,
      };
    case OnboardingScenario.APPROVE_BLOCKED:
      return { requirements: [], screenings: [], openBlocked: true };
    case OnboardingScenario.APPROVE:
      return { requirements: [], screenings: [], openBlocked: false };
  }
}

export enum PixOutScenario {
  /** Recusa por saldo insuficiente, mesmo havendo saldo. */
  INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS',
  /** Devolve 500 do provedor. */
  PROVIDER_ERROR = 'PROVIDER_ERROR',
  /**
   * Nao responde. Exercita o caminho de desfecho desconhecido: a transacao vai
   * para UNKNOWN e so a conciliacao resolve. Este e o cenario que a maioria
   * das integracoes nunca testa.
   */
  TIMEOUT = 'TIMEOUT',
  /** Liquida e devolve automaticamente apos 5 segundos. */
  AUTO_REFUND = 'AUTO_REFUND',
  /** Liquida, mas o webhook e entregue duas vezes. */
  DUPLICATE_WEBHOOK = 'DUPLICATE_WEBHOOK',
  /** Liquida, mas o webhook de liquidacao chega ANTES do de pendente. */
  OUT_OF_ORDER_WEBHOOK = 'OUT_OF_ORDER_WEBHOOK',
  SETTLE = 'SETTLE',
}

const PIX_OUT_BY_CENTS: Readonly<Record<string, PixOutScenario>> = Object.freeze({
  '13': PixOutScenario.INSUFFICIENT_FUNDS,
  '51': PixOutScenario.PROVIDER_ERROR,
  '29': PixOutScenario.TIMEOUT,
  '44': PixOutScenario.AUTO_REFUND,
  '07': PixOutScenario.DUPLICATE_WEBHOOK,
  '08': PixOutScenario.OUT_OF_ORDER_WEBHOOK,
});

/** Deriva o cenario dos dois ultimos digitos do valor em centavos. */
export function pixOutScenarioFor(amountCents: bigint): PixOutScenario {
  const cents = (amountCents % 100n).toString().padStart(2, '0');
  return PIX_OUT_BY_CENTS[cents] ?? PixOutScenario.SETTLE;
}

/** Documentacao legivel dos valores magicos, servida em GET /_control/magic. */
export const MAGIC_VALUE_REFERENCE = Object.freeze({
  onboarding: Object.freeze({
    description: 'Comportamento derivado dos dois ultimos digitos do CPF ou CNPJ.',
    suffixes: ONBOARDING_BY_SUFFIX,
    default: OnboardingScenario.APPROVE,
  }),
  pixOut: Object.freeze({
    description: 'Comportamento derivado dos dois ultimos digitos do valor em centavos.',
    cents: PIX_OUT_BY_CENTS,
    default: PixOutScenario.SETTLE,
  }),
});
