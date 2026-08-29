import { Global, Module, type Provider } from '@nestjs/common';
import type { Redis } from 'ioredis';

import {
  ACCOUNT_REPOSITORY,
  HOLDER_REPOSITORY,
  ONBOARDING_REPOSITORY,
} from '../accounts/accounts.types.js';
import { CONSOLE_SESSION_REPOSITORY, CONSOLE_USER_REPOSITORY } from '../admin/admin.types.js';
import { API_KEY_REPOSITORY, NONCE_STORE } from '../auth/api-key.service.js';
import { CLOCK, type Clock } from '../common/clock.js';
import { ApiConfig } from '../config/config.service.js';
import {
  AGGREGATE_LOCK,
  KeyedMutexLock,
  RedisAggregateLock,
} from '../events/aggregate-lock.js';
import { AUDIT_REPOSITORY, OUTBOX_REPOSITORY } from '../events/outbox.types.js';
import { IDEMPOTENCY_REPOSITORY } from '../idempotency/idempotency.types.js';
import {
  OPERATION_REPOSITORY,
  PIX_CHARGE_REPOSITORY,
  PIX_KEY_REPOSITORY,
  TRANSACTION_REPOSITORY,
} from '../pix/pix.types.js';
import { CONNECTION_REPOSITORY } from '../providers/credential.resolver.js';
import { CONNECTION_LOOKUP } from '../providers/provider.registry.js';
import { PROVIDER_CALL_SINK } from '../providers/provider.resolver.js';
import { INBOUND_EVENT_REPOSITORY } from '../webhooks/webhooks.types.js';

import { PrismaApiKeyRepository } from './api-key.repository.js';
import { PrismaConnectionRepository } from './connection.repository.js';
import {
  PrismaConsoleSessionRepository,
  PrismaConsoleUserRepository,
} from './console.repository.js';
import {
  PrismaAccountRepository,
  PrismaAuditRepository,
  PrismaHolderRepository,
  PrismaInboundEventRepository,
  PrismaOnboardingRepository,
  PrismaOutboxRepository,
} from './domain.repositories.js';
import { PrismaIdempotencyRepository } from './idempotency.repository.js';
import {
  MemoryAccountRepository,
  MemoryAuditRepository,
  MemoryHolderRepository,
  MemoryInboundEventRepository,
  MemoryOnboardingRepository,
  MemoryOutboxRepository,
} from './memory/domain.repositories.js';
import { MemoryIdempotencyRepository } from './memory/idempotency.repository.js';
import {
  MemoryOperationRepository,
  MemoryPixChargeRepository,
  MemoryPixKeyRepository,
  MemoryTransactionRepository,
} from './memory/pix.repositories.js';
import { InMemoryNonceStore, RedisNonceStore } from './nonce.store.js';
import {
  PrismaOperationRepository,
  PrismaPixChargeRepository,
  PrismaPixKeyRepository,
  PrismaTransactionRepository,
} from './pix.repositories.js';
import { PrismaService } from './prisma.service.js';
import { NoopProviderCallSink, ProviderCallRecorder } from './provider-call.sink.js';
import { REDIS, redisProvider } from './redis.provider.js';

/**
 * Raiz de composicao da persistencia.
 *
 * Todo repositorio e ligado ao seu token AQUI, e nao por decorator no
 * consumidor. E o que mantem `auth`, `idempotency` e `providers` ignorantes do
 * Prisma: eles conhecem interfaces, e o teste substitui a implementacao sem
 * subir banco.
 */
@Global()
@Module({
  providers: [
    PrismaService,
    redisProvider,
    PrismaApiKeyRepository,
    PrismaConnectionRepository,
    PrismaIdempotencyRepository,
    PrismaConsoleUserRepository,
    PrismaConsoleSessionRepository,
    PrismaHolderRepository,
    PrismaAccountRepository,
    PrismaOnboardingRepository,
    PrismaOutboxRepository,
    PrismaAuditRepository,
    PrismaInboundEventRepository,
    PrismaTransactionRepository,
    PrismaPixKeyRepository,
    PrismaPixChargeRepository,
    PrismaOperationRepository,
    ProviderCallRecorder,
    { provide: API_KEY_REPOSITORY, useExisting: PrismaApiKeyRepository },
    {
      provide: IDEMPOTENCY_REPOSITORY,
      inject: [ApiConfig, PrismaIdempotencyRepository, CLOCK],
      useFactory: (
        config: ApiConfig,
        prismaImplementation: PrismaIdempotencyRepository,
        clock: Clock,
      ) => (config.isTest ? new MemoryIdempotencyRepository(clock) : prismaImplementation),
    },
    { provide: CONNECTION_REPOSITORY, useExisting: PrismaConnectionRepository },
    { provide: CONNECTION_LOOKUP, useExisting: PrismaConnectionRepository },
    { provide: CONSOLE_USER_REPOSITORY, useExisting: PrismaConsoleUserRepository },
    { provide: CONSOLE_SESSION_REPOSITORY, useExisting: PrismaConsoleSessionRepository },

    // Repositorios de dominio: Prisma em producao, memoria em teste.
    //
    // A troca e por implementacao, nao por flag espalhada pelo codigo: os
    // servicos conhecem so as interfaces, entao a suite de ponta a ponta
    // exercita o caminho completo — controller, guard, adapter, mapeamento,
    // guard monotonico, outbox, auditoria — sem Postgres.
    domainProvider(HOLDER_REPOSITORY, PrismaHolderRepository, MemoryHolderRepository),
    domainProvider(ACCOUNT_REPOSITORY, PrismaAccountRepository, MemoryAccountRepository),
    domainProvider(ONBOARDING_REPOSITORY, PrismaOnboardingRepository, MemoryOnboardingRepository),
    domainProvider(OUTBOX_REPOSITORY, PrismaOutboxRepository, MemoryOutboxRepository),
    domainProvider(AUDIT_REPOSITORY, PrismaAuditRepository, MemoryAuditRepository),
    domainProvider(
      INBOUND_EVENT_REPOSITORY,
      PrismaInboundEventRepository,
      MemoryInboundEventRepository,
    ),
    domainProvider(TRANSACTION_REPOSITORY, PrismaTransactionRepository, MemoryTransactionRepository),
    domainProvider(PIX_KEY_REPOSITORY, PrismaPixKeyRepository, MemoryPixKeyRepository),
    domainProvider(PIX_CHARGE_REPOSITORY, PrismaPixChargeRepository, MemoryPixChargeRepository),
    domainProvider(OPERATION_REPOSITORY, PrismaOperationRepository, MemoryOperationRepository),
    {
      provide: PROVIDER_CALL_SINK,
      inject: [ApiConfig, ProviderCallRecorder],
      useFactory: (config: ApiConfig, recorder: ProviderCallRecorder) =>
        config.isTest ? new NoopProviderCallSink() : recorder,
    },
    {
      provide: AGGREGATE_LOCK,
      inject: [ApiConfig, REDIS],
      useFactory: (config: ApiConfig, redis: Redis) =>
        // Em teste nao ha Redis e o processo e um so: o mutex em memoria da a
        // MESMA garantia. Em producao seria falso — cada pod teria sua propria
        // ordem, e dois consumidores aplicariam o mesmo agregado ao mesmo
        // tempo.
        config.isTest ? new KeyedMutexLock() : new RedisAggregateLock(redis),
    },
    {
      provide: NONCE_STORE,
      inject: [ApiConfig, REDIS, CLOCK],
      useFactory: (config: ApiConfig, redis: Redis, clock: Clock) =>
        // Em teste nao ha Redis; o store em memoria basta porque o processo e
        // um so. Em producao seria uma falha de seguranca: cada pod teria seu
        // proprio conjunto de nonces e um replay dirigido a outro pod passaria.
        config.isTest ? new InMemoryNonceStore(clock) : new RedisNonceStore(redis),
    },
  ],
  exports: [
    PrismaService,
    REDIS,
    API_KEY_REPOSITORY,
    IDEMPOTENCY_REPOSITORY,
    CONNECTION_REPOSITORY,
    CONNECTION_LOOKUP,
    CONSOLE_USER_REPOSITORY,
    CONSOLE_SESSION_REPOSITORY,
    HOLDER_REPOSITORY,
    ACCOUNT_REPOSITORY,
    ONBOARDING_REPOSITORY,
    OUTBOX_REPOSITORY,
    AUDIT_REPOSITORY,
    INBOUND_EVENT_REPOSITORY,
    TRANSACTION_REPOSITORY,
    PIX_KEY_REPOSITORY,
    PIX_CHARGE_REPOSITORY,
    OPERATION_REPOSITORY,
    PROVIDER_CALL_SINK,
    NONCE_STORE,
    AGGREGATE_LOCK,
  ],
})
export class PersistenceModule {}

/**
 * Liga um token de repositorio a implementacao do ambiente.
 *
 * Em teste, a versao em memoria; caso contrario, a de Prisma. A decisao e
 * tomada UMA vez, aqui, e nenhum servico precisa saber qual esta ligada.
 */
function domainProvider(
  token: symbol,
  prismaClass: new (...args: never[]) => unknown,
  memoryClass: new () => unknown,
): Provider {
  return {
    provide: token,
    inject: [ApiConfig, prismaClass as never],
    useFactory: (config: ApiConfig, prismaImplementation: unknown) =>
      config.isTest ? new memoryClass() : prismaImplementation,
  };
}
