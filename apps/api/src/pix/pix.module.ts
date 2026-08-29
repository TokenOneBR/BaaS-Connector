import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { ProvidersModule } from '../providers/providers.module.js';

import { PixChargesService } from './pix-charges.service.js';
import { PixKeysService } from './pix-keys.service.js';
import { PixController } from './pix.controller.js';

/**
 * Fluxos de dinheiro.
 *
 * Chaves e cobrancas primeiro; transferencias, devolucoes e extrato entram nos
 * commits seguintes, no mesmo modulo — todos compartilham o razao sombra e o
 * mesmo `ActorContext`.
 */
@Module({
  imports: [ProvidersModule, AccountsModule, LedgerModule],
  controllers: [PixController],
  providers: [PixKeysService, PixChargesService],
})
export class PixModule {}
