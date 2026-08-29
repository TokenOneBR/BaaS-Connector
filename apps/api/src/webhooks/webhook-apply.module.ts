import { Module, OnModuleInit } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module.js';
import { InProcessEventQueue } from '../events/in-process-queue.js';
import { EVENT_QUEUE } from '../events/outbox.types.js';
import { ProvidersModule } from '../providers/providers.module.js';

import { WebhookApplyService } from './webhook-apply.service.js';

/**
 * Aplicacao de evento ao dominio, sem HTTP.
 *
 * Separado de `WebhooksModule` porque o WORKER precisa deste servico e nao
 * precisa do controller. Um controller instanciado num contexto de aplicacao
 * sem servidor HTTP e custo puro — nunca e roteado — e amarraria o grafo do
 * worker a toda mudanca de rota da API.
 *
 * A FILA vem junto, e nao no modulo do controller: o servico de aplicacao
 * reenfileira quando perde o lock do agregado, entao ele DEPENDE da fila.
 * Deixar o binding do lado do controller inverteria a direcao e o container
 * nao resolveria.
 */
@Module({
  imports: [ProvidersModule, AccountsModule],
  providers: [
    WebhookApplyService,
    InProcessEventQueue,
    { provide: EVENT_QUEUE, useExisting: InProcessEventQueue },
  ],
  exports: [WebhookApplyService, EVENT_QUEUE],
})
export class WebhookApplyModule implements OnModuleInit {
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
