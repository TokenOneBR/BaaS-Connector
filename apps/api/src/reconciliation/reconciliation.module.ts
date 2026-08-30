import { Module } from '@nestjs/common';

import { AdminModule } from '../admin/admin.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';

import { BreakResolutionService } from './break-resolution.service.js';
import { ReconciliationController } from './reconciliation.controller.js';

/**
 * Superficie de conciliacao do console.
 *
 * Importa `AdminModule` pelo `AdminSessionGuard`: o guard e um provider dele,
 * e sem isto a rota compilaria com o decorator e sem autenticacao nenhuma —
 * o `@Public()` da classe ja desligou o guard de API key.
 */
@Module({
  imports: [AdminModule, LedgerModule],
  controllers: [ReconciliationController],
  providers: [BreakResolutionService],
  exports: [BreakResolutionService],
})
export class ReconciliationModule {}
