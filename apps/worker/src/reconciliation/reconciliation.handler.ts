import type { ReconciliationJob, ReconciliationSweepJob } from '@baasconn/api/domain';
import { Injectable, type OnModuleInit } from '@nestjs/common';

import { QueueHandlerRegistry } from '../queues/handler.registry.js';

import { ReconciliationSweepService } from './reconciliation-sweep.service.js';
import { ReconciliationService } from './reconciliation.service.js';

@Injectable()
export class ReconciliationHandler implements OnModuleInit {
  constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly sweep: ReconciliationSweepService,
    private readonly registry: QueueHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register('reconciliation_sweep', (job: ReconciliationSweepJob) =>
      this.sweep.sweep(job.scope).then(() => undefined),
    );
    this.registry.register('reconciliation', (job: ReconciliationJob) =>
      this.reconciliation.run(job.environment, job.runId),
    );
  }
}
