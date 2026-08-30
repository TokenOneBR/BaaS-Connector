import {
  LedgerModule,
  PersistenceModule,
  ProvidersModule,
  WebhookApplyModule,
} from '@baasconn/api/domain';
import { Module } from '@nestjs/common';

import { AutoResolutionService } from './auto-resolution.service.js';
import { ReconciliationSweepService } from './reconciliation-sweep.service.js';
import { ReconciliationHandler } from './reconciliation.handler.js';
import { ReconciliationScheduler } from './reconciliation.scheduler.js';
import { ReconciliationService } from './reconciliation.service.js';

@Module({
  imports: [PersistenceModule, ProvidersModule, LedgerModule, WebhookApplyModule],
  providers: [
    ReconciliationService,
    ReconciliationSweepService,
    AutoResolutionService,
    ReconciliationHandler,
    ReconciliationScheduler,
  ],
  exports: [ReconciliationService, ReconciliationSweepService],
})
export class ReconciliationModule {}
