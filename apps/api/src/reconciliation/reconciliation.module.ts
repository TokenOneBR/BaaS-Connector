import { Module } from '@nestjs/common';

import { LedgerModule } from '../ledger/ledger.module.js';

import { BreakResolutionService } from './break-resolution.service.js';
import { ReconciliationController } from './reconciliation.controller.js';

/**
 * Superficie de conciliacao do console.
 *
 * NAO importa `AdminModule`. A autenticacao vem da guarda de superficie
 * global, que cobre `/admin/v1` por caminho — e e o que desfaz o acoplamento:
 * antes, todo modulo com rota de console precisava importar `AdminModule` so
 * para alcancar o guard, o que produziria ciclo assim que `AccountsModule`
 * ganhasse a sua.
 */
@Module({
  imports: [LedgerModule],
  controllers: [ReconciliationController],
  providers: [BreakResolutionService],
  exports: [BreakResolutionService],
})
export class ReconciliationModule {}
