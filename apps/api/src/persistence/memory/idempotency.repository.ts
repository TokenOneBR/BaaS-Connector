import { hostname } from 'node:os';

import { newId, systemClock, type Clock, type Environment } from '@baasconn/taxonomy';
import { Injectable } from '@nestjs/common';

import type {
  ClaimResult,
  IdempotencyRecord,
  IdempotencyRepository,
} from '../../idempotency/idempotency.types.js';

const POD_ID = hostname();

/**
 * Store de idempotencia em memoria.
 *
 * Reproduz a semantica que importa da versao Postgres — `INSERT ... ON
 * CONFLICT DO NOTHING`, roubo de lease condicional, e a distincao entre
 * completar e liberar — para que a suite exercite o interceptor de verdade
 * sem banco.
 *
 * NAO serve para producao: sem durabilidade, o registro se perde num restart e
 * a garantia de "exatamente um efeito colateral" cai junto.
 */
@Injectable()
export class MemoryIdempotencyRepository implements IdempotencyRepository {
  readonly records = new Map<string, IdempotencyRecord>();
  readonly released: string[] = [];

  constructor(private readonly clock: Clock = systemClock) {}

  private key(environment: string, endpointKey: string, key: string): string {
    return `${environment}|${endpointKey}|${key}`;
  }

  async claim(input: Parameters<IdempotencyRepository['claim']>[0]): Promise<ClaimResult> {
    const index = this.key(input.environment, input.endpointKey, input.key);
    const existing = this.records.get(index);
    if (existing) return { claimed: false, stolen: false, record: existing };

    const now = this.clock.now();
    const record: IdempotencyRecord = {
      id: newId('idempotency'),
      environment: input.environment,
      apiKeyId: input.apiKeyId,
      endpointKey: input.endpointKey,
      key: input.key,
      requestFingerprint: input.requestFingerprint,
      state: 'IN_FLIGHT',
      operationId: newId('operation'),
      lockedBy: POD_ID,
      leaseExpiresAt: new Date(now.getTime() + input.leaseSeconds * 1000),
      createdAt: now,
      expiresAt: new Date(now.getTime() + input.ttlSeconds * 1000),
    };

    this.records.set(index, record);
    return { claimed: true, stolen: false, record };
  }

  async find(environment: Environment, endpointKey: string, key: string) {
    return this.records.get(this.key(environment, endpointKey, key));
  }

  async stealLease(id: string, leaseSeconds: number) {
    const now = this.clock.now();
    for (const record of this.records.values()) {
      if (record.id !== id) continue;
      // Condicional, como o `WHERE lease_expires_at <= now()` do Postgres: dois
      // pods podem tentar, mas so um encontra a linha ainda vencida.
      if (record.leaseExpiresAt && record.leaseExpiresAt > now) return undefined;
      record.leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000);
      record.lockedBy = POD_ID;
      return record;
    }
    return undefined;
  }

  async renewLease(id: string, leaseSeconds: number) {
    for (const record of this.records.values()) {
      if (record.id === id) {
        record.leaseExpiresAt = new Date(this.clock.now().getTime() + leaseSeconds * 1000);
      }
    }
  }

  async complete(input: Parameters<IdempotencyRepository['complete']>[0]) {
    for (const record of this.records.values()) {
      if (record.id !== input.id) continue;
      record.state = input.state;
      record.responseStatus = input.status;
      record.responseBody = input.body;
      record.errorCode = input.errorCode ?? null;
      record.completedAt = this.clock.now();
      record.leaseExpiresAt = null;
    }
  }

  async release(id: string) {
    this.released.push(id);
    for (const [index, record] of this.records) {
      if (record.id === id) this.records.delete(index);
    }
  }
}
