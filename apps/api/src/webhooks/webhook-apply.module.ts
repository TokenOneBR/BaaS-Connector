import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module.js';
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
 * Este modulo CONSOME `EVENT_QUEUE` e nao a liga: qual implementacao usar e
 * decisao do processo. A API liga a fila em processo; o worker liga o BullMQ.
 */
@Module({
  imports: [ProvidersModule, AccountsModule],
  providers: [WebhookApplyService],
  exports: [WebhookApplyService],
})
export class WebhookApplyModule {}
