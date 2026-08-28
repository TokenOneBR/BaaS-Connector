import type { EventType, TransactionStatus } from '@baasconn/taxonomy';

export interface WebhookSecret {
  value: string;
  /** Segredo anterior, valido durante a janela de rotacao. */
  previous?: string;
}

export interface RawWebhookRequest {
  /**
   * Bytes exatos do corpo, capturados ANTES do parse JSON.
   * Reserializar muda a assinatura e ela deixa de conferir.
   */
  readonly rawBody: Buffer;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly query: Readonly<Record<string, string>>;
  readonly receivedAt: Date;
}

/**
 * Evento canonico como o adapter o produz, antes de o core atribuir id,
 * sequencia e instante de publicacao.
 */
export interface CanonicalEventDraft {
  type: EventType;
  /** Agregado afetado, identificado no espaco do provedor. */
  subject: {
    kind: 'account' | 'transaction' | 'charge' | 'onboarding' | 'pix_key';
    providerId: string;
  };
  occurredAt?: string;
  data: Record<string, unknown>;
  /** Estado alvo, quando o evento e uma transicao. Dirige o guard monotonico. */
  transitionTo?: TransactionStatus | string;
}
