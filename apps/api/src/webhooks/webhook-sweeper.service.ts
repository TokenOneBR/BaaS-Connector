import type { Clock } from '@baasconn/taxonomy';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { CLOCK } from '../common/clock.js';
import { ApiConfig } from '../config/config.service.js';
import { EVENT_QUEUE, type EventQueue } from '../events/outbox.types.js';

import { INBOUND_EVENT_REPOSITORY, type InboundEventRepository } from './webhooks.types.js';

/** Janela apos a qual um evento parado e considerado abandonado. */
const STALE_AFTER_MS = 60_000;
const SWEEP_INTERVAL_MS = 15_000;
const BATCH = 100;

/**
 * Varredor de eventos presos.
 *
 * Reenfileira o que continua `RECEIVED` alem da janela. E o que torna
 * verdadeira a frase "perda de fila custa latencia, nunca dados": o evento ja
 * esta no Postgres antes de ser enfileirado, entao um pod que morre entre as
 * duas coisas nao perde nada — so atrasa.
 */
@Injectable()
export class WebhookSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookSweeper.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly config: ApiConfig,
    @Inject(INBOUND_EVENT_REPOSITORY) private readonly events: InboundEventRepository,
    @Inject(EVENT_QUEUE) private readonly queue: EventQueue,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    // Em teste o varredor fica parado: um timer de fundo transforma teste
    // deterministico em teste intermitente.
    if (this.config.isTest) return;
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<number> {
    const cutoff = new Date(this.clock.now().getTime() - STALE_AFTER_MS);
    const stale = await this.events.findStale(cutoff, BATCH);

    for (const event of stale) {
      await this.queue.enqueue({ kind: 'inbound_webhook', eventId: event.id });
    }

    if (stale.length > 0) {
      this.logger.warn({ count: stale.length }, 'Eventos reenfileirados pelo varredor');
    }
    return stale.length;
  }
}
