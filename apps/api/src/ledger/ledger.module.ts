import type { Clock } from '@baasconn/taxonomy';
import { Global, Module } from '@nestjs/common';

import { CLOCK } from '../common/clock.js';
import { ApiConfig } from '../config/config.service.js';
import { PrismaService } from '../persistence/prisma.service.js';

import { LEDGER_STORE_FACTORY } from './ledger.types.js';
import { MemoryLedgerStoreFactory } from './memory-ledger-store.js';
import { PrismaLedgerStoreFactory } from './prisma-ledger-store.js';
import { ShadowLedgerService } from './shadow-ledger.service.js';

/**
 * Razao sombra.
 *
 * `@Global` porque contas, PIX e conciliacao lancam nele, e reimportar em cada
 * modulo so produziria ruido. A troca memoria/Postgres segue o mesmo padrao
 * dos repositorios de dominio.
 */
@Global()
@Module({
  providers: [
    ShadowLedgerService,
    {
      provide: LEDGER_STORE_FACTORY,
      inject: [ApiConfig, PrismaService, CLOCK],
      useFactory: (config: ApiConfig, prisma: PrismaService, clock: Clock) =>
        config.isTest
          ? new MemoryLedgerStoreFactory(clock)
          : new PrismaLedgerStoreFactory(prisma, clock),
    },
  ],
  exports: [ShadowLedgerService, LEDGER_STORE_FACTORY],
})
export class LedgerModule {}
