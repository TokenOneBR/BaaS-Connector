import { Module } from '@nestjs/common';

import { ProvidersModule } from '../providers/providers.module.js';

import { WebhookApplyModule } from './webhook-apply.module.js';
import { WebhookSweeper } from './webhook-sweeper.service.js';
import { WebhooksController } from './webhooks.controller.js';

/** A superficie HTTP de webhook. A aplicacao ao dominio vive no modulo fino. */
@Module({
  imports: [ProvidersModule, WebhookApplyModule],
  controllers: [WebhooksController],
  providers: [WebhookSweeper],
  exports: [WebhookApplyModule],
})
export class WebhooksModule {}
