import type { OperationResolveJob, PollJob } from '@baasconn/api/domain';
import { Injectable, type OnModuleInit } from '@nestjs/common';

import { PollService } from '../poller/poll.service.js';
import { QueueHandlerRegistry } from '../queues/handler.registry.js';

import { UnknownOutcomeLadderService } from './ladder.service.js';

@Injectable()
export class LadderHandler implements OnModuleInit {
  constructor(
    private readonly ladder: UnknownOutcomeLadderService,
    private readonly poll: PollService,
    private readonly registry: QueueHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register('operation_resolve', (job: OperationResolveJob) =>
      this.ladder.step(job.environment, job.operationId, job.step),
    );
    this.registry.register('poll', (job: PollJob) =>
      // `scopeId` e a conta: o extrato do SPI e por conta, nao por conexao.
      job.scopeId
        ? this.poll.poll(job.connectionId, job.scopeId).then(() => undefined)
        : Promise.resolve(),
    );
  }
}
