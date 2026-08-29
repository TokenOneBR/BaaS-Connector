import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module.js';
import { ProvidersModule } from '../providers/providers.module.js';

import { DefaultBalanceSignals } from './balance-signals.js';
import { BalanceController } from './balance.controller.js';
import { BALANCE_SIGNALS, BalanceService } from './balance.service.js';

@Module({
  imports: [ProvidersModule, AccountsModule],
  controllers: [BalanceController],
  providers: [BalanceService, { provide: BALANCE_SIGNALS, useClass: DefaultBalanceSignals }],
  exports: [BalanceService],
})
export class BalanceModule {}
