import type { Environment } from '@baasconn/taxonomy';

import type {
  ApiKeyRecord,
  ApiKeyRepository,
  CreateApiKeyRow,
} from '../../auth/api-key.service.js';

interface StoredKey extends ApiKeyRecord {
  secretHash: string;
  secretLookup: Buffer;
}

/**
 * Dobro de API keys.
 *
 * Guarda o hash junto, mas `list`/`findById` devolvem `ApiKeyRecord`, que nao
 * tem o campo — a mesma separacao que o Prisma faz por `select`. Se o dobro
 * publicasse o hash onde o real nao publica, o teste que prova a ausencia de
 * vazamento estaria medindo o dobro em vez do produto.
 */
export class MemoryApiKeyRepository implements ApiKeyRepository {
  readonly rows = new Map<string, StoredKey>();

  async findByLookup(lookup: Buffer) {
    const row = [...this.rows.values()].find(
      (candidate) => Buffer.compare(candidate.secretLookup, lookup) === 0,
    );
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      environment: row.environment,
      scopes: row.scopes,
      secretHash: row.secretHash,
      signingRequired: row.signingRequired,
      defaultConnectionId: row.defaultConnectionId,
      ipAllowlist: row.ipAllowlist,
      rateLimitTier: row.rateLimitTier,
      status: row.status as 'ACTIVE' | 'REVOKED' | 'EXPIRED',
      expiresAt: row.expiresAt ?? null,
    };
  }

  async touchLastUsed(): Promise<void> {}

  async list(environment: Environment, status?: string): Promise<ApiKeyRecord[]> {
    return [...this.rows.values()]
      .filter((row) => row.environment === environment)
      .filter((row) => !status || row.status === status)
      .map(toRecord);
  }

  async findById(environment: Environment, id: string): Promise<ApiKeyRecord | undefined> {
    const row = this.rows.get(id);
    return row?.environment === environment ? toRecord(row) : undefined;
  }

  async create(input: CreateApiKeyRow): Promise<ApiKeyRecord> {
    const row: StoredKey = {
      id: input.id,
      environment: input.environment,
      name: input.name,
      prefix: input.prefix,
      last4: input.last4,
      scopes: input.scopes,
      signingRequired: input.signingRequired,
      ipAllowlist: input.ipAllowlist,
      rateLimitTier: 'standard',
      defaultConnectionId: input.defaultConnectionId,
      status: 'ACTIVE',
      expiresAt: input.expiresAt,
      createdAt: input.at,
      secretHash: input.secretHash,
      secretLookup: input.secretLookup,
    };
    this.rows.set(row.id, row);
    return toRecord(row);
  }

  async revoke(environment: Environment, id: string, at: Date): Promise<ApiKeyRecord | undefined> {
    const row = this.rows.get(id);
    if (!row || row.environment !== environment || row.status !== 'ACTIVE') return undefined;
    row.status = 'REVOKED';
    row.lastUsedAt = row.lastUsedAt ?? at;
    return toRecord(row);
  }
}

function toRecord(row: StoredKey): ApiKeyRecord {
  const { secretHash: _hash, secretLookup: _lookup, ...record } = row;
  return record;
}
