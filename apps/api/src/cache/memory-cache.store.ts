import { systemClock, type Clock } from '@baasconn/taxonomy';

import type { CacheEntry, CacheStore } from './cache.types.js';

interface Slot {
  value: unknown;
  asOf: Date;
  expiresAtMs: number;
  tags: readonly string[];
}

/**
 * Cache em processo.
 *
 * Serve o desenvolvimento e a suite: o Redis nunca conecta em teste
 * (`enableOfflineQueue: false` faz o primeiro comando falhar de imediato, e
 * nao esperar). Reproduz a semantica que importa — TTL, etiquetas e
 * single-flight — para que as regras de bypass sejam exercitadas de verdade.
 *
 * NAO serve para producao com mais de um pod: cada processo teria o seu, e um
 * evento que invalida num pod deixaria os outros servindo valor velho.
 */
export class InMemoryCacheStore implements CacheStore {
  private readonly slots = new Map<string, Slot>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(private readonly clock: Clock = systemClock) {}

  private now(): number {
    return this.clock.now().getTime();
  }

  async get<T>(key: string): Promise<CacheEntry<T> | undefined> {
    const slot = this.slots.get(key);
    if (!slot) return undefined;
    if (slot.expiresAtMs <= this.now()) {
      this.slots.delete(key);
      return undefined;
    }
    return { value: slot.value as T, asOf: slot.asOf };
  }

  async set<T>(
    key: string,
    value: T,
    options: { ttlSeconds: number; asOf: Date; tags?: readonly string[] },
  ): Promise<void> {
    this.slots.set(key, {
      value,
      asOf: options.asOf,
      expiresAtMs: this.now() + options.ttlSeconds * 1000,
      tags: options.tags ?? [],
    });
  }

  async delete(key: string): Promise<void> {
    this.slots.delete(key);
  }

  async invalidateTag(tag: string): Promise<void> {
    for (const [key, slot] of this.slots) {
      if (slot.tags.includes(tag)) this.slots.delete(key);
    }
  }

  async singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const running = this.inFlight.get(key);
    if (running) return running as Promise<T>;

    const work = fn().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, work);
    return work;
  }

  /** Para o teste: quantas chaves estao vivas. */
  get size(): number {
    return this.slots.size;
  }
}
