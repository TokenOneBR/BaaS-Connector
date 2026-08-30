import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { AccountsModule } from './accounts/accounts.module.js';
import { AdminSurfaceGuard } from './admin/admin-surface.guard.js';
import { AdminModule } from './admin/admin.module.js';
import { ApiKeyGuard } from './auth/api-key.guard.js';
import { ApiKeyService } from './auth/api-key.service.js';
import { CapabilityGuard } from './auth/capability.guard.js';
import { BalanceModule } from './balance/balance.module.js';
import { CacheModule } from './cache/cache.module.js';
import { CanonicalErrorFilter } from './common/error.filter.js';
import { RawBodyMiddleware } from './common/raw-body.middleware.js';
import { RequestContextMiddleware } from './common/request-context.middleware.js';
import { ConfigModule } from './config/config.module.js';
import { CryptoModule } from './crypto/crypto.module.js';
import { InProcessQueueModule } from './events/in-process-queue.module.js';
import {
  HealthController,
  READINESS_PROBES,
  type ReadinessProbe,
} from './health/health.controller.js';
import { IdempotencyInterceptor } from './idempotency/idempotency.interceptor.js';
import { LedgerModule } from './ledger/ledger.module.js';
import { ObservabilityModule } from './observability/observability.module.js';
import { PersistenceModule } from './persistence/persistence.module.js';
import { PrismaService } from './persistence/prisma.service.js';
import { REDIS } from './persistence/redis.provider.js';
import { PixModule } from './pix/pix.module.js';
import { ProvidersModule } from './providers/providers.module.js';
import { ReconciliationModule } from './reconciliation/reconciliation.module.js';
import { WebhooksModule } from './webhooks/webhooks.module.js';

@Module({
  imports: [
    ConfigModule,
    ObservabilityModule,
    CryptoModule,
    CacheModule,
    LedgerModule,
    PersistenceModule,
    ProvidersModule,
    AdminModule,
    AccountsModule,
    BalanceModule,
    PixModule,
    ReconciliationModule,
    InProcessQueueModule,
    WebhooksModule,
  ],
  controllers: [HealthController],
  providers: [
    ApiKeyService,
    {
      provide: READINESS_PROBES,
      inject: [PrismaService, REDIS],
      useFactory: (prisma: PrismaService, redis: { ping(): Promise<string> }): ReadinessProbe[] => [
        { name: 'postgres', check: () => prisma.ping() },
        {
          name: 'redis',
          check: () =>
            redis
              .ping()
              .then((reply) => reply === 'PONG')
              .catch(() => false),
        },
      ],
    },

    // O filtro vem antes dos guards: um erro de autenticacao tambem precisa
    // sair no envelope canonico.
    { provide: APP_FILTER, useClass: CanonicalErrorFilter },
    // ANTES do ApiKeyGuard: `/admin/v1` inteiro exige sessao de console, por
    // caminho e nao por decorator. Ver `admin-surface.guard.ts`.
    { provide: APP_GUARD, useClass: AdminSurfaceGuard },
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_GUARD, useClass: CapabilityGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Primeiro de todos: assim ate o log de falha de autenticacao ja sai
    // correlacionado com o requestId que o cliente recebeu.
    consumer.apply(RequestContextMiddleware).forRoutes('*');

    // So nas rotas de webhook. Nas demais, os bytes crus vem do `verify` do
    // parser JSON, em main.ts.
    consumer.apply(RawBodyMiddleware).forRoutes({ path: 'webhooks/*', method: RequestMethod.ALL });
  }
}
