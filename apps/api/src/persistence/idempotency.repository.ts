import { hostname } from 'node:os';

import type { Prisma } from '@baasconn/db';
import { newId } from '@baasconn/taxonomy';
import type { Clock, Environment } from '@baasconn/taxonomy';
import { Inject, Injectable } from '@nestjs/common';

import { CLOCK } from '../common/clock.js';
import type {
  ClaimResult,
  IdempotencyRecord,
  IdempotencyRepository,
} from '../idempotency/idempotency.types.js';


import { PrismaService } from './prisma.service.js';

const POD_ID = hostname();

/**
 * Store de idempotencia no Postgres.
 *
 * No Postgres, e nao no Redis: o registro precisa participar da MESMA
 * transacao da escrita de dominio para a garantia de "exatamente um efeito
 * colateral" valer. Um registro no Redis que sobrevive a um rollback do
 * Postgres bloqueia para sempre uma operacao que nunca aconteceu; um que se
 * perde num failover libera um pagamento para ser feito duas vezes.
 */
@Injectable()
export class PrismaIdempotencyRepository implements IdempotencyRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async claim(input: {
    environment: Environment;
    apiKeyId: string;
    endpointKey: string;
    key: string;
    requestFingerprint: string;
    leaseSeconds: number;
    ttlSeconds: number;
  }): Promise<ClaimResult> {
    const now = this.clock.now();
    const candidate = {
      id: newId('idempotency'),
      environment: input.environment,
      apiKeyId: input.apiKeyId,
      endpointKey: input.endpointKey,
      key: input.key,
      requestFingerprint: input.requestFingerprint,
      state: 'IN_FLIGHT' as const,
      operationId: newId('operation'),
      lockedBy: POD_ID,
      lockedAt: now,
      leaseExpiresAt: new Date(now.getTime() + input.leaseSeconds * 1000),
      expiresAt: new Date(now.getTime() + input.ttlSeconds * 1000),
    };

    // `createMany` com `skipDuplicates` e o INSERT ... ON CONFLICT DO NOTHING
    // do Prisma: uma unica ida ao banco, e a corrida entre dois pods e
    // decidida pelo indice unico, nao por um SELECT-entao-INSERT.
    const inserted = await this.prisma.client.idempotencyRecord.createMany({
      data: [candidate],
      skipDuplicates: true,
    });

    if (inserted.count === 1) {
      return { claimed: true, stolen: false, record: toRecord({ ...candidate, createdAt: now }) };
    }

    const existing = await this.find(input.environment, input.endpointKey, input.key);
    if (!existing) {
      // A linha sumiu entre o conflito e a leitura: so o varredor de TTL
      // apaga, entao isto e uma corrida com ele. Tentar de novo e correto.
      return this.claim(input);
    }

    return { claimed: false, stolen: false, record: existing };
  }

  async find(
    environment: Environment,
    endpointKey: string,
    key: string,
  ): Promise<IdempotencyRecord | undefined> {
    const row = await this.prisma.client.idempotencyRecord.findUnique({
      where: { environment_endpointKey_key: { environment, endpointKey, key } },
    });
    return row ? toRecord(row) : undefined;
  }

  /**
   * Rouba um lease abandonado.
   *
   * O `WHERE leaseExpiresAt <= now()` e o que torna a operacao segura sob
   * concorrencia: dois pods podem tentar, mas so um encontra a linha ainda
   * vencida, e o perdedor recebe undefined em vez de reexecutar em paralelo.
   */
  async stealLease(id: string, leaseSeconds: number): Promise<IdempotencyRecord | undefined> {
    const now = this.clock.now();
    const result = await this.prisma.client.idempotencyRecord.updateMany({
      where: { id, state: 'IN_FLIGHT', leaseExpiresAt: { lte: now } },
      data: {
        lockedBy: POD_ID,
        lockedAt: now,
        leaseExpiresAt: new Date(now.getTime() + leaseSeconds * 1000),
      },
    });
    if (result.count === 0) return undefined;

    const row = await this.prisma.client.idempotencyRecord.findUnique({ where: { id } });
    return row ? toRecord(row) : undefined;
  }

  async renewLease(id: string, leaseSeconds: number): Promise<void> {
    await this.prisma.client.idempotencyRecord.update({
      where: { id },
      data: { leaseExpiresAt: new Date(this.clock.now().getTime() + leaseSeconds * 1000) },
    });
  }

  async complete(input: {
    id: string;
    status: number;
    body: unknown;
    state: 'COMPLETED' | 'FAILED';
    errorCode?: string;
  }): Promise<void> {
    await this.prisma.client.idempotencyRecord.update({
      where: { id: input.id },
      data: {
        state: input.state,
        responseStatus: input.status,
        responseBody: (input.body ?? null) as Prisma.InputJsonValue,
        errorCode: input.errorCode ?? null,
        completedAt: this.clock.now(),
        leaseExpiresAt: null,
        lockedBy: null,
      },
    });
  }

  async release(id: string): Promise<void> {
    await this.prisma.client.idempotencyRecord.delete({ where: { id } }).catch(() => undefined);
  }
}

function toRecord(row: {
  id: string;
  environment: string;
  apiKeyId: string;
  endpointKey: string;
  key: string;
  requestFingerprint: string;
  state: string;
  operationId: string;
  responseStatus?: number | null;
  responseBody?: unknown;
  errorCode?: string | null;
  lockedBy?: string | null;
  leaseExpiresAt?: Date | null;
  createdAt: Date;
  completedAt?: Date | null;
  expiresAt: Date;
}): IdempotencyRecord {
  return {
    id: row.id,
    environment: row.environment as Environment,
    apiKeyId: row.apiKeyId,
    endpointKey: row.endpointKey,
    key: row.key,
    requestFingerprint: row.requestFingerprint,
    state: row.state as IdempotencyRecord['state'],
    operationId: row.operationId,
    responseStatus: row.responseStatus ?? null,
    responseBody: row.responseBody,
    errorCode: row.errorCode ?? null,
    lockedBy: row.lockedBy ?? null,
    leaseExpiresAt: row.leaseExpiresAt ?? null,
    createdAt: row.createdAt,
    completedAt: row.completedAt ?? null,
    expiresAt: row.expiresAt,
  };
}
