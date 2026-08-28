import type { Clock } from '@baasconn/taxonomy';
import { Injectable } from '@nestjs/common';
import type Redis from 'ioredis';

import type { NonceStore } from '../auth/api-key.service.js';

/**
 * Registro de nonces de assinatura, no Redis.
 *
 * `SET NX EX` e a operacao inteira: atomica, com expiracao automatica. O TTL
 * cobre o dobro da janela de tolerancia, entao um nonce so e esquecido depois
 * que a propria assinatura ja teria expirado por timestamp — nao existe
 * intervalo em que um replay passe.
 */
@Injectable()
export class RedisNonceStore implements NonceStore {
  constructor(private readonly redis: Redis) {}

  async claim(keyId: string, nonce: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.set(`baas:nonce:${keyId}:${nonce}`, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }
}

/**
 * Store em memoria, para desenvolvimento e teste.
 *
 * NAO serve para producao com mais de um pod: cada processo teria seu proprio
 * conjunto de nonces, e um replay dirigido a outro pod passaria.
 */
@Injectable()
export class InMemoryNonceStore implements NonceStore {
  private readonly seen = new Map<string, number>();

  constructor(private readonly clock: Clock) {}

  async claim(keyId: string, nonce: string, ttlSeconds: number): Promise<boolean> {
    const now = this.clock.now().getTime();
    for (const [key, expiry] of this.seen) if (expiry <= now) this.seen.delete(key);

    const composite = `${keyId}:${nonce}`;
    if (this.seen.has(composite)) return false;
    this.seen.set(composite, now + ttlSeconds * 1000);
    return true;
  }
}
