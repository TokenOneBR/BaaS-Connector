import { systemClock, type Clock } from '@baasconn/taxonomy';
import { Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';

import type { CacheEntry, CacheStore } from './cache.types.js';

/** Espera maxima do perdedor do single-flight antes de chamar a origem. */
const SINGLE_FLIGHT_WAIT_MS = 3_000;
const SINGLE_FLIGHT_LOCK_MS = 5_000;
const POLL_INTERVAL_MS = 25;

interface Envelope<T> {
  value: T;
  asOf: string;
}

/**
 * Cache no Redis.
 *
 * Falhar em ler ou gravar cache NUNCA propaga: o cache e otimizacao, e um
 * Redis instavel precisa custar latencia, nunca disponibilidade. Todo caminho
 * abaixo degrada para "sem cache" em vez de lancar.
 */
@Injectable()
export class RedisCacheStore implements CacheStore {
  private readonly logger = new Logger(RedisCacheStore.name);

  constructor(
    private readonly redis: Redis,
    private readonly clock: Clock = systemClock,
  ) {}

  async get<T>(key: string): Promise<CacheEntry<T> | undefined> {
    try {
      const raw = await this.redis.get(key);
      if (!raw) return undefined;
      const envelope = JSON.parse(raw) as Envelope<T>;
      return { value: envelope.value, asOf: new Date(envelope.asOf) };
    } catch (error) {
      this.logger.warn({ err: error, key }, 'Falha ao ler do cache; seguindo sem ele');
      return undefined;
    }
  }

  async set<T>(
    key: string,
    value: T,
    options: { ttlSeconds: number; asOf: Date; tags?: readonly string[] },
  ): Promise<void> {
    try {
      const envelope: Envelope<T> = { value, asOf: options.asOf.toISOString() };
      const pipeline = this.redis.pipeline();
      pipeline.set(key, JSON.stringify(envelope), 'EX', options.ttlSeconds);

      for (const tag of options.tags ?? []) {
        pipeline.sadd(tag, key);
        // A etiqueta expira depois do valor: um conjunto que sobrevivesse
        // para sempre viraria lixo acumulado a cada conta ja vista.
        pipeline.expire(tag, options.ttlSeconds * 2);
      }

      await pipeline.exec();
    } catch (error) {
      this.logger.warn({ err: error, key }, 'Falha ao gravar no cache; seguindo sem ele');
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.redis.unlink(key);
    } catch (error) {
      this.logger.warn({ err: error, key }, 'Falha ao apagar do cache');
    }
  }

  /**
   * Apaga tudo que carrega a etiqueta.
   *
   * `SMEMBERS` + `UNLINK`, nunca `SCAN` ou `KEYS`: os dois varrem o keyspace
   * inteiro, e num caminho quente isso e uma parada do Redis para apagar tres
   * chaves. `UNLINK` em vez de `DEL` porque a liberacao acontece em outra
   * thread e nao bloqueia.
   */
  async invalidateTag(tag: string): Promise<void> {
    try {
      const keys = await this.redis.smembers(tag);
      if (keys.length > 0) await this.redis.unlink(...keys, tag);
      else await this.redis.unlink(tag);
    } catch (error) {
      this.logger.warn({ err: error, tag }, 'Falha ao invalidar etiqueta de cache');
    }
  }

  /**
   * Um miss vira UMA chamada a origem.
   *
   * Quem pega o lock executa; os demais aguardam o valor aparecer, com teto.
   * Passado o teto, o perdedor chama a origem — esperar para sempre por um pod
   * que morreu seguraria a requisicao ate o timeout do cliente.
   */
  async singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const lockKey = `baas:sf:${key}`;

    let acquired = false;
    try {
      acquired = (await this.redis.set(lockKey, '1', 'PX', SINGLE_FLIGHT_LOCK_MS, 'NX')) === 'OK';
    } catch (error) {
      this.logger.warn({ err: error, key }, 'Falha ao adquirir single-flight; chamando a origem');
      return fn();
    }

    if (acquired) {
      try {
        return await fn();
      } finally {
        await this.redis.unlink(lockKey).catch(() => undefined);
      }
    }

    const deadline = this.clock.now().getTime() + SINGLE_FLIGHT_WAIT_MS;
    while (this.clock.now().getTime() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const cached = await this.get<T>(key);
      if (cached) return cached.value;
    }

    return fn();
  }
}
