import { Module, OnModuleInit } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module.js';
import { InProcessEventQueue } from '../events/in-process-queue.js';
import { EVENT_QUEUE } from '../events/outbox.types.js';
import { ProvidersModule } from '../providers/providers.module.js';

import { WebhookApplyService } from './webhook-apply.service.js';
import { WebhookSweeper } from './webhook-sweeper.service.js';
import { WebhooksController } from './webhooks.controller.js';

@Module({
  imports: [ProvidersModule, AccountsModule],
  controllers: [WebhooksController],
  providers: [
    WebhookApplyService,
    WebhookSweeper,
    InProcessEventQueue,
    { provide: EVENT_QUEUE, useExisting: InProcessEventQueue },
  ],
  exports: [WebhookApplyService, EVENT_QUEUE],
})
export class WebhooksModule implements OnModuleInit {
  constructor(
    private readonly queue: InProcessEventQueue,
    private readonly apply: WebhookApplyService,
  ) {}

  /**
   * Liga a fila ao consumidor.
   *
   * A ligacao e aqui, e nao no construtor da fila, para a fila nao conhecer o
   * servico de dominio — e o que permite trocar a implementacao por BullMQ
   * mexendo so nesta linha.
   */
  onModuleInit(): void {
    this.queue.setHandler(async (job) => {
      if (job.kind === 'inbound_webhook') await this.apply.apply(job.eventId);
    });
  }
}
