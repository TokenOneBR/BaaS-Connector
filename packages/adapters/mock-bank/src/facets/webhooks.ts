import { createHmac, timingSafeEqual } from 'node:crypto';

import type {
  CanonicalEventDraft,
  RawWebhookRequest,
  WebhookFacet,
  WebhookSecret,
} from '@baasconn/provider-spi';
import {
  BaasError,
  BaasErrorCode,
  EventType,
  OnboardingStatus,
  TransactionStatus,
} from '@baasconn/taxonomy';

import type { MbPaymentEvent, MbWebhookEnvelope } from '../dto/index.js';
import { toAccountStatusFromEvent } from '../mappers/account.js';
import { fromCents } from '../mappers/money.js';
import { toCounterparty, toTransactionStatus } from '../mappers/pix.js';

const SIGNATURE_HEADER = 'x-mockbank-signature';
const EVENT_ID_HEADER = 'x-mockbank-event-id';

/** Janela de tolerancia do timestamp assinado. */
const TOLERANCE_SECONDS = 300;

export function buildWebhooksFacet(): WebhookFacet {
  return {
    /**
     * Verificacao de assinatura, pura e sobre os BYTES CRUS.
     *
     * Reserializar o JSON muda espacamento e ordem de chave, e a assinatura
     * deixa de conferir — e o bug mais comum de integracao de webhook. Por isso
     * o SPI entrega `rawBody: Buffer` e nunca um objeto ja parseado.
     */
    verifySignature(request: RawWebhookRequest, secret: WebhookSecret): void {
      const header = headerOf(request, SIGNATURE_HEADER);
      if (!header) {
        throw new BaasError(BaasErrorCode.SIGNATURE_INVALID, {
          message: `Cabecalho ${SIGNATURE_HEADER} ausente.`,
        });
      }

      const parsed = parseSignatureHeader(header);
      if (!parsed) {
        throw new BaasError(BaasErrorCode.SIGNATURE_INVALID, {
          message: `Cabecalho ${SIGNATURE_HEADER} malformado. Esperado "t=<unix>,v1=<hex>".`,
        });
      }

      const skew = Math.abs(Math.floor(request.receivedAt.getTime() / 1000) - parsed.timestamp);
      if (skew > TOLERANCE_SECONDS) {
        throw new BaasError(BaasErrorCode.SIGNATURE_EXPIRED, {
          message: `Assinatura fora da janela de ${TOLERANCE_SECONDS}s.`,
        });
      }

      // O segredo anterior continua valendo durante a rotacao: sem isso, girar
      // o segredo derrubaria todo webhook em voo naquele instante.
      const candidates = [secret.value, secret.previous].filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
      );

      const signed = `${parsed.timestamp}.${request.rawBody.toString('utf8')}`;
      const matched = candidates.some((candidate) =>
        constantTimeEqual(createHmac('sha256', candidate).update(signed).digest('hex'), parsed.v1),
      );

      if (!matched) throw new BaasError(BaasErrorCode.SIGNATURE_INVALID);
    },

    /**
     * Identidade do evento, estavel entre reentregas.
     *
     * O Mock Bank reenvia a duplicata com o MESMO `id` e um `attempt` maior —
     * derivar a identidade do corpo inteiro faria a duplicata parecer um evento
     * novo e o saldo do cliente seria creditado duas vezes.
     */
    eventIdentity(request: RawWebhookRequest) {
      const fromHeader = headerOf(request, EVENT_ID_HEADER);
      const envelope = safeParse(request.rawBody);

      const providerEventId = fromHeader ?? envelope?.id;
      if (!providerEventId) {
        throw new BaasError(BaasErrorCode.PROVIDER_CONTRACT_VIOLATION, {
          message: 'Evento sem identificador: nem cabecalho nem corpo trazem um id.',
        });
      }

      return { providerEventId, occurredAt: envelope?.occurredAt };
    },

    parse(request: RawWebhookRequest): CanonicalEventDraft[] {
      const envelope = safeParse(request.rawBody);
      if (!envelope) {
        throw new BaasError(BaasErrorCode.PROVIDER_CONTRACT_VIOLATION, {
          message: 'Corpo do webhook nao e JSON valido.',
        });
      }
      return translate(envelope);
    },

    ackResponse() {
      return { status: 200, body: { received: true } };
    },
  };
}

function translate(envelope: MbWebhookEnvelope): CanonicalEventDraft[] {
  const occurredAt = envelope.occurredAt;

  switch (envelope.type) {
    case 'account.status_changed': {
      const data = envelope.data as { account_id: string; status: string };
      return [
        {
          type: EventType.ACCOUNT_STATUS_CHANGED,
          subject: { kind: 'account', providerId: data.account_id },
          occurredAt,
          transitionTo: toAccountStatusFromEvent(data.status),
          data: { status: toAccountStatusFromEvent(data.status) },
        },
      ];
    }

    case 'onboarding.status_changed': {
      const data = envelope.data as {
        onboarding_id: string;
        account_id: string;
        status: string;
        rejection_code?: string;
        pending_requirements?: string[];
      };
      return [
        {
          // O Mock Bank tem um evento so; o vocabulario canonico e mais fino, e
          // e o fino que o cliente assina. Colapsar tudo em "status mudou"
          // obrigaria cada consumidor a reimplementar esta traducao.
          type: onboardingEventType(data.status),
          subject: { kind: 'onboarding', providerId: data.onboarding_id },
          occurredAt,
          transitionTo: data.status,
          data: {
            providerAccountId: data.account_id,
            status: data.status,
            rejectionCode: data.rejection_code,
            pendingRequirements: data.pending_requirements ?? [],
          },
        },
      ];
    }

    case 'pix_out.pending':
    case 'pix_out.settled':
    case 'pix_in.received':
    case 'pix_refund.settled':
      return [paymentDraft(envelope, occurredAt)];

    case 'pix_charge.paid': {
      const data = envelope.data as {
        txid: string;
        status: string;
        paid_amount_cents: string;
        transaction_id: string;
      };
      return [
        {
          type: EventType.PIX_CHARGE_PAID,
          subject: { kind: 'charge', providerId: data.txid },
          occurredAt,
          data: {
            status: data.status,
            paidAmount: fromCents(data.paid_amount_cents),
            providerTransactionId: data.transaction_id,
          },
        },
      ];
    }

    default:
      // Evento desconhecido nao lanca: o provedor acrescenta tipos sem avisar,
      // e um throw aqui faria o handler devolver 500 e o Mock Bank comecar a
      // fazer backoff em TODOS os eventos, inclusive os que entendemos.
      return [];
  }
}

function paymentDraft(envelope: MbWebhookEnvelope, occurredAt: string): CanonicalEventDraft {
  const data = envelope.data as unknown as MbPaymentEvent;
  const status = toTransactionStatus(data.status);

  return {
    type: eventTypeFor(envelope.type, status),
    subject: { kind: 'transaction', providerId: data.transaction_id },
    occurredAt,
    transitionTo: status,
    data: {
      providerAccountId: data.account_id,
      direction: data.direction,
      status,
      // Nos eventos o valor vem em CENTAVOS; no REST vem em decimal. Trocar as
      // duas leituras produz um erro de fator 100 que passa em revisao porque
      // os dois valores parecem plausiveis.
      amount: fromCents(data.amount_cents),
      fee: fromCents(data.fee_cents),
      endToEndId: data.end_to_end_id,
      returnId: data.return_id,
      txid: data.txid,
      counterparty: toCounterparty(data.counterparty),
      createdAt: data.created_at,
      settledAt: data.settled_at,
    },
  };
}

function eventTypeFor(mockType: string, status: TransactionStatus): EventType {
  if (mockType === 'pix_in.received') return EventType.PIX_IN_RECEIVED;
  if (mockType === 'pix_refund.settled') return EventType.PIX_REFUND_SETTLED;
  if (status === TransactionStatus.SETTLED) return EventType.PIX_OUT_SETTLED;
  if (status === TransactionStatus.FAILED) return EventType.PIX_OUT_FAILED;
  return EventType.PIX_OUT_PENDING;
}

/** Traduz o evento unico do provedor para o vocabulario canonico. */
function onboardingEventType(status: string): EventType {
  switch (status) {
    case OnboardingStatus.APPROVED:
      return EventType.ONBOARDING_APPROVED;
    case OnboardingStatus.REJECTED:
      return EventType.ONBOARDING_REJECTED;
    case OnboardingStatus.EXPIRED:
      return EventType.ONBOARDING_EXPIRED;
    case OnboardingStatus.PENDING_REQUIREMENTS:
      return EventType.ONBOARDING_REQUIREMENTS_UPDATED;
    case OnboardingStatus.MANUAL_REVIEW:
    case OnboardingStatus.IN_ANALYSIS:
      return EventType.ONBOARDING_UNDER_REVIEW;
    default:
      return EventType.ONBOARDING_SUBMITTED;
  }
}

function headerOf(request: RawWebhookRequest, name: string): string | undefined {
  const value = request.headers[name] ?? request.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function parseSignatureHeader(header: string): { timestamp: number; v1: string } | undefined {
  const parts = new Map<string, string>();
  for (const chunk of header.split(',')) {
    const separator = chunk.indexOf('=');
    if (separator <= 0) continue;
    parts.set(chunk.slice(0, separator).trim(), chunk.slice(separator + 1).trim());
  }

  const timestamp = Number(parts.get('t'));
  const v1 = parts.get('v1');
  if (!Number.isFinite(timestamp) || !v1) return undefined;
  return { timestamp, v1 };
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function safeParse(raw: Buffer): MbWebhookEnvelope | undefined {
  try {
    return JSON.parse(raw.toString('utf8')) as MbWebhookEnvelope;
  } catch {
    return undefined;
  }
}
