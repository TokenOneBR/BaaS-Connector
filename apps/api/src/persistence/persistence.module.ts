import { Global, Module } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { CONSOLE_SESSION_REPOSITORY, CONSOLE_USER_REPOSITORY } from '../admin/admin.types.js';
import { API_KEY_REPOSITORY, NONCE_STORE } from '../auth/api-key.service.js';
import { CLOCK, type Clock } from '../common/clock.js';
import { ApiConfig } from '../config/config.service.js';
import { IDEMPOTENCY_REPOSITORY } from '../idempotency/idempotency.types.js';
import { CONNECTION_REPOSITORY } from '../providers/credential.resolver.js';
import { CONNECTION_LOOKUP } from '../providers/provider.registry.js';
import { PROVIDER_CALL_SINK } from '../providers/provider.resolver.js';

import { PrismaApiKeyRepository } from './api-key.repository.js';
import { PrismaConnectionRepository } from './connection.repository.js';
import {
  PrismaConsoleSessionRepository,
  PrismaConsoleUserRepository,
} from './console.repository.js';
import { PrismaIdempotencyRepository } from './idempotency.repository.js';
import { InMemoryNonceStore, RedisNonceStore } from './nonce.store.js';
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
    ProviderCallRecorder,
    { provide: API_KEY_REPOSITORY, useExisting: PrismaApiKeyRepository },
    { provide: IDEMPOTENCY_REPOSITORY, useExisting: PrismaIdempotencyRepository },
    { provide: CONNECTION_REPOSITORY, useExisting: PrismaConnectionRepository },
    { provide: CONNECTION_LOOKUP, useExisting: PrismaConnectionRepository },
    { provide: CONSOLE_USER_REPOSITORY, useExisting: PrismaConsoleUserRepository },
    { provide: CONSOLE_SESSION_REPOSITORY, useExisting: PrismaConsoleSessionRepository },
    {
      provide: PROVIDER_CALL_SINK,
      inject: [ApiConfig, ProviderCallRecorder],
      useFactory: (config: ApiConfig, recorder: ProviderCallRecorder) =>
        config.isTest ? new NoopProviderCallSink() : recorder,
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
    PROVIDER_CALL_SINK,
    NONCE_STORE,
  ],
})
export class PersistenceModule {}
