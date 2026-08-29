import { Global, Module, OnModuleInit } from '@nestjs/common';

import { WebhookApplyModule } from '../webhooks/webhook-apply.module.js';
import { WebhookApplyService } from '../webhooks/webhook-apply.service.js';

import { InProcessEventQueue } from './in-process-queue.js';
import { EVENT_QUEUE } from './outbox.types.js';

/**
 * Liga `EVENT_QUEUE` a fila em processo.
 *
 * `@Global` porque quem consome a porta esta espalhado (o controller de
 * webhook, o servico de aplicacao, o varredor) e porque a decisao de QUAL
 * implementacao usar e do processo, nao de um modulo.
 *
 * E por isso que o binding NAO vive em `WebhookApplyModule`: o worker importa
 * aquele modulo e precisa que a MESMA porta aponte para o BullMQ. Com o
 * binding la dentro, o servico receberia a fila em processo mesmo rodando no
 * worker, e um reenfileiramento por disputa de lock morreria com o pod.
 *
 * Fica fora de `./domain` de proposito: se o worker conseguisse importa-la,
 * um dia alguem a liga por engano e ele processa em memoria, sem durabilidade,
 * ate um pod morrer com jobs em voo.
 */
@Global()
@Module({
  imports: [WebhookApplyModule],
  providers: [InProcessEventQueue, { provide: EVENT_QUEUE, useExisting: InProcessEventQueue }],
  exports: [EVENT_QUEUE],
})
export class InProcessQueueModule implements OnModuleInit {
  constructor(
    private readonly queue: InProcessEventQueue,
    private readonly apply: WebhookApplyService,
  ) {}

  /**
   * Liga a fila ao consumidor.
   *
   * A ligacao e aqui, e nao no construtor da fila, para a fila nao conhecer o
   * servico de dominio — e o que permite trocar a implementacao por BullMQ
   * mexendo so no modulo.
   */
  onModuleInit(): void {
    this.queue.setHandler(async (job) => {
      if (job.kind === 'inbound_webhook') await this.apply.apply(job.eventId);
    });
  }
}
