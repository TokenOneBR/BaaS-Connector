import { createHmac } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { request as undiciRequest } from 'undici';

import { MockClock } from '../common/clock.provider.js';
import { MockBankStore } from '../common/store.js';
import { MockBankConfig } from '../config/config.service.js';

export interface MockWebhookEvent {
  id: string;
  type: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

export interface DeliveryRecord {
  eventId: string;
  type: string;
  url: string;
  attempt: number;
  status: 'SENT' | 'FAILED';
  responseStatus?: number;
  at: string;
  /** True quando o Mock Bank duplicou a entrega de proposito. */
  duplicated?: boolean;
  outOfOrder?: boolean;
}

/**
 * Entrega de webhooks do Mock Bank.
 *
 * A assinatura segue o esquema da Stripe (`t=<unix>,v1=<hmac>`) porque e o que
 * o conector ja sabe verificar e o que ha snippet em toda linguagem.
 *
 * As entregas ficam num log consultavel: sem isso, um teste que verifica
 * dedupe de webhook nao tem como afirmar que a segunda entrega realmente
 * aconteceu.
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private readonly deliveries: DeliveryRecord[] = [];
  private sequence = 0;

  constructor(
    private readonly config: MockBankConfig,
    private readonly clock: MockClock,
    private readonly store: MockBankStore,
  ) {}

  registerUrl(clientId: string, url: string): void {
    this.store.webhookUrls.set(clientId, url);
  }

  urlFor(clientId: string): string | undefined {
    return this.store.webhookUrls.get(clientId);
  }

  get log(): readonly DeliveryRecord[] {
    return this.deliveries;
  }

  clearLog(): void {
    this.deliveries.length = 0;
  }

  sign(body: string, timestamp: number, secret = this.config.webhookSecret): string {
    const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    return `t=${timestamp},v1=${signature}`;
  }

  nextEventId(): string {
    this.sequence += 1;
    return `mbevt_${this.sequence.toString().padStart(10, '0')}`;
  }

  /**
   * Emite um evento.
   *
   * `options.duplicate` e `options.outOfOrder` sao os cenarios de valor magico:
   * webhook duplicado e webhook fora de ordem sao comportamento REAL de
   * provedor, e o conector precisa absorver os dois.
   */
  async emit(
    clientId: string,
    type: string,
    data: Record<string, unknown>,
    options: { duplicate?: boolean; outOfOrder?: boolean; delayMs?: number } = {},
  ): Promise<void> {
    const url = this.urlFor(clientId);
    if (!url) {
      this.logger.debug(
        `Nenhuma URL de webhook para o cliente ${clientId}; evento ${type} descartado`,
      );
      return;
    }

    const event: MockWebhookEvent = {
      id: this.nextEventId(),
      type,
      occurredAt: this.clock.now().toISOString(),
      data,
    };

    const duplicate = options.duplicate ?? this.store.faults.duplicateWebhooks;
    const times = duplicate ? 2 : 1;

    for (let attempt = 1; attempt <= times; attempt++) {
      if (options.delayMs) await this.sleep(options.delayMs);
      await this.deliver(url, event, attempt, {
        duplicated: attempt > 1,
        outOfOrder: options.outOfOrder ?? this.store.faults.reorderWebhooks,
      });
    }
  }

  private async deliver(
    url: string,
    event: MockWebhookEvent,
    attempt: number,
    flags: { duplicated: boolean; outOfOrder: boolean },
  ): Promise<void> {
    const body = JSON.stringify(event);
    const timestamp = Math.floor(this.clock.now().getTime() / 1000);
    // Assinatura invalida injetada: o conector deve recusar com 401 e nao
    // processar. E um evento de seguranca, nao um bug.
    const secret = this.store.faults.invalidSignature
      ? 'segredo-errado'
      : this.config.webhookSecret;

    const record: DeliveryRecord = {
      eventId: event.id,
      type: event.type,
      url,
      attempt,
      status: 'FAILED',
      at: this.clock.now().toISOString(),
      duplicated: flags.duplicated,
      outOfOrder: flags.outOfOrder,
    };

    try {
      const response = await undiciRequest(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-mockbank-signature': this.sign(body, timestamp, secret),
          'x-mockbank-event-id': event.id,
          'x-mockbank-event-type': event.type,
          'x-mockbank-attempt': String(attempt),
        },
        body,
        headersTimeout: 5_000,
        bodyTimeout: 5_000,
      });
      await response.body.text();
      record.responseStatus = response.statusCode;
      record.status = response.statusCode < 300 ? 'SENT' : 'FAILED';
    } catch (error) {
      this.logger.warn(`Falha ao entregar ${event.type} em ${url}: ${(error as Error).message}`);
    }

    this.deliveries.push(record);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
