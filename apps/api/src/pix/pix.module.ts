import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { ProvidersModule } from '../providers/providers.module.js';

import { OperationReconcilerModule } from './operation-reconciler.module.js';
import { PixChargesService } from './pix-charges.service.js';
import { PixKeysService } from './pix-keys.service.js';
import { PixTransfersService } from './pix-transfers.service.js';
import { PixController } from './pix.controller.js';
import { StatementService } from './statement.service.js';
import { TransactionsController } from './transactions.controller.js';

/**
 * Fluxos de dinheiro.
 *
 * Chaves, cobrancas, transferencias, devolucoes, extrato e o resolvedor de
 * desfecho desconhecido moram juntos porque compartilham o razao sombra e o
 * mesmo `ActorContext` — e porque separar transferencia de conciliacao criaria
 * um ciclo entre modulos sem isolar nada.
 */
@Module({
  imports: [ProvidersModule, AccountsModule, LedgerModule, OperationReconcilerModule],
  controllers: [PixController, TransactionsController],
  providers: [
    PixKeysService,
    PixChargesService,
    PixTransfersService,
    StatementService,
  ],
  exports: [PixTransfersService, OperationReconcilerModule],
})
export class PixModule {}
