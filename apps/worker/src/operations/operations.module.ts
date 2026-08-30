import {
  OperationReconcilerModule,
  PersistenceModule,
  ProvidersModule,
  WebhookApplyModule,
} from '@baasconn/api/domain';
import { Module } from '@nestjs/common';

import { PollScheduler } from '../poller/poll.scheduler.js';
import { PollService } from '../poller/poll.service.js';

import { LadderHandler } from './ladder.handler.js';
import { UnknownOutcomeLadderService } from './ladder.service.js';

/**
 * Escada e poller.
 *
 * `OperationReconcilerModule` e o modulo FINO: importar `PixModule` poria
 * `PixTransfersService` no grafo do worker, e a regra da conciliacao e "nunca
 * reenvia" — a forma mais barata de garanti-la e ele nao conseguir.
 */
@Module({
  imports: [PersistenceModule, ProvidersModule, OperationReconcilerModule, WebhookApplyModule],
  providers: [UnknownOutcomeLadderService, PollService, PollScheduler, LadderHandler],
  exports: [UnknownOutcomeLadderService, PollService, PollScheduler],
})
export class OperationsModule {}
