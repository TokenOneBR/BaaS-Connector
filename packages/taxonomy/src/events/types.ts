import type { Environment, ProviderSlug } from '../enums/core.js';

/** Nome canonico de evento no formato `recurso.acao`. */
export enum EventType {
  HOLDER_CREATED = 'holder.created',
  HOLDER_UPDATED = 'holder.updated',

  ACCOUNT_CREATED = 'account.created',
  ACCOUNT_ACTIVATED = 'account.activated',
  ACCOUNT_STATUS_CHANGED = 'account.status_changed',
  ACCOUNT_BLOCKED = 'account.blocked',
  ACCOUNT_CLOSED = 'account.closed',

  ONBOARDING_SUBMITTED = 'onboarding.submitted',
  ONBOARDING_REQUIREMENTS_UPDATED = 'onboarding.requirements_updated',
  ONBOARDING_UNDER_REVIEW = 'onboarding.under_review',
  ONBOARDING_APPROVED = 'onboarding.approved',
  ONBOARDING_REJECTED = 'onboarding.rejected',
  ONBOARDING_EXPIRED = 'onboarding.expired',
  COMPLIANCE_SCREENING_COMPLETED = 'compliance.screening_completed',
  COMPLIANCE_ALERT_RAISED = 'compliance.alert_raised',

  BALANCE_UPDATED = 'balance.updated',

  PIX_KEY_REGISTERED = 'pix_key.registered',
  PIX_KEY_REMOVED = 'pix_key.removed',
  PIX_KEY_CLAIM_RECEIVED = 'pix_key.claim_received',

  PIX_CHARGE_CREATED = 'pix_charge.created',
  PIX_CHARGE_PAID = 'pix_charge.paid',
  PIX_CHARGE_EXPIRED = 'pix_charge.expired',

  TRANSACTION_CREATED = 'transaction.created',
  TRANSACTION_UPDATED = 'transaction.updated',
  PIX_IN_RECEIVED = 'pix_in.received',
  PIX_OUT_PENDING = 'pix_out.pending',
  PIX_OUT_SETTLED = 'pix_out.settled',
  PIX_OUT_FAILED = 'pix_out.failed',
  /** Devolucao que NOS enviamos, no momento em que o provedor a aceita. */
  PIX_REFUND_CREATED = 'pix_refund.created',
  PIX_REFUND_RECEIVED = 'pix_refund.received',
  PIX_REFUND_SETTLED = 'pix_refund.settled',

  RECONCILIATION_RUN_COMPLETED = 'reconciliation.run_completed',
  RECONCILIATION_BREAK_OPENED = 'reconciliation.break_opened',
  PROVIDER_DEGRADED = 'provider.degraded',
}

export type EventResourceKind =
  | 'holder'
  | 'account'
  | 'onboarding'
  | 'screening'
  | 'balance'
  | 'pix_key'
  | 'pix_charge'
  | 'transaction'
  | 'reconciliation_run'
  | 'reconciliation_break'
  | 'provider';

/**
 * Envelope de evento canonico.
 *
 * `sequence` e monotonico por ambiente: permite ao consumidor detectar um
 * evento perdido e chamar o endpoint de replay, em vez de descobrir a lacuna
 * pela ausencia de dinheiro.
 */
export interface EventEnvelope<T = unknown> {
  id: string;
  type: EventType;
  specVersion: '1.0';
  /** Versao do schema deste `type` especifico. */
  dataVersion: number;
  /** Quando o fato ocorreu, no relogio do provedor quando disponivel. */
  occurredAt: string;
  publishedAt: string;
  environment: Environment;
  provider?: ProviderSlug;
  connectionId?: string;
  resource: { type: EventResourceKind; id: string };
  sequence: string;
  data: T;
  /** Presente em `*.updated` e `*.status_changed`. */
  previous?: Partial<T>;
  /** `true` quando environment === PRODUCAO. Espelha a convencao da Stripe. */
  livemode: boolean;
}

/** Cabecalhos de entrega de webhook de saida. */
export const WEBHOOK_HEADERS = {
  SIGNATURE: 'x-baas-signature',
  EVENT_ID: 'x-baas-event-id',
  EVENT_TYPE: 'x-baas-event-type',
  DELIVERY_ID: 'x-baas-delivery-id',
  ATTEMPT: 'x-baas-attempt',
  ENVIRONMENT: 'x-baas-environment',
} as const;

/** Tolerancia de timestamp na verificacao de assinatura, em segundos. */
export const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;

/**
 * Escada de retry de webhook de saida: 10 tentativas em ~72h.
 * Jitter de +/-20% e aplicado no dispatcher.
 */
export const WEBHOOK_RETRY_SCHEDULE_SECONDS: readonly number[] = Object.freeze([
  10, 30, 120, 600, 1_800, 3_600, 10_800, 21_600, 43_200, 86_400,
]);
