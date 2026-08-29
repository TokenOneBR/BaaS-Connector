import type { Clock } from '@baasconn/taxonomy';
import { Global, Module } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { CLOCK } from '../common/clock.js';
import { ApiConfig } from '../config/config.service.js';
import { REDIS } from '../persistence/redis.provider.js';

import { CACHE_STORE } from './cache.types.js';
import { InMemoryCacheStore } from './memory-cache.store.js';
import { RedisCacheStore } from './redis-cache.store.js';

/**
 * Cache.
 *
 * `@Global` porque saldo, conta e onboarding cacheiam, e reimportar em cada
 * modulo so produziria ruido. Em teste o Redis nunca conecta
 * (`enableOfflineQueue: false` faz o primeiro comando falhar de imediato),
 * entao a versao em memoria e a unica que funciona ali.
 */
@Global()
@Module({
  providers: [
    {
      provide: CACHE_STORE,
      inject: [ApiConfig, REDIS, CLOCK],
      useFactory: (config: ApiConfig, redis: Redis, clock: Clock) =>
        config.isTest ? new InMemoryCacheStore(clock) : new RedisCacheStore(redis, clock),
    },
  ],
  exports: [CACHE_STORE],
})
export class CacheModule {}
