import {
  OUTBOX_DISPATCH_REPOSITORY,
  WEBHOOK_DELIVERY_REPOSITORY,
  type OutboxDispatchRepository,
  type OutboxDispatchJob,
  type WebhookDeliveryRepository,
} from '@baasconn/api/domain';
import { Injectable, Inject, Logger, type OnModuleInit } from '@nestjs/common';

import { QueueHandlerRegistry } from '../queues/handler.registry.js';

import { OutboxDispatcherService } from './outbox-dispatcher.service.js';

/**
 * Liga o job de entrega ao despachante.
 *
 * O job carrega so o `deliveryId`; a linha e o evento sao relidos do Postgres.
 * Carregar o payload no job faria a fila guardar uma segunda copia do evento,
 * e uma reentrega depois de uma correcao no banco mandaria o valor velho.
 */
@Injectable()
export class OutboxHandler implements OnModuleInit {
  private readonly logger = new Logger(OutboxHandler.name);

  constructor(
    private readonly dispatcher: OutboxDispatcherService,
    private readonly registry: QueueHandlerRegistry,
    @Inject(WEBHOOK_DELIVERY_REPOSITORY) private readonly deliveries: WebhookDeliveryRepository,
    @Inject(OUTBOX_DISPATCH_REPOSITORY) private readonly outbox: OutboxDispatchRepository,
  ) {}

  onModuleInit(): void {
    this.registry.register('outbox_dispatch', (job) => this.handle(job));
  }

  async handle(job: OutboxDispatchJob): Promise<void> {
    const delivery = await this.deliveries.findById(job.deliveryId);
    // Some silenciosamente de proposito: o varredor e o caminho quente podem
    // enfileirar a mesma entrega, e a que perder ja a encontra concluida.
    if (!delivery || delivery.status !== 'PENDING') return;

    const event = await this.outbox.findEventById(delivery.eventId);
    if (!event) {
      this.logger.error(
        { delivery_id: job.deliveryId, event_id: delivery.eventId },
        'Entrega aponta para evento inexistente',
      );
      return;
    }

    await this.dispatcher.deliver(job.deliveryId, event);
  }
}
