import { EnvelopeCrypto } from '@baasconn/crypto';
import type { ProviderCredentials } from '@baasconn/provider-spi';
import { BaasError, BaasErrorCode, type Clock, type Environment } from '@baasconn/taxonomy';
import { Inject, Injectable } from '@nestjs/common';

import { CLOCK } from '../common/clock.js';

export interface StoredConnection {
  id: string;
  environment: Environment;
  provider: string;
  status: string;
  baseUrl?: string | null;
  config: Record<string, unknown>;
  credentials: {
    ciphertext: Buffer;
    iv: Buffer;
    tag: Buffer;
    wrappedKey: Buffer;
    keyId: string;
    version: number;
  };
  webhookSecret?: {
    ciphertext: Buffer;
    iv: Buffer;
    tag: Buffer;
    wrappedKey: Buffer;
    keyId: string;
  } | null;
}

export const CONNECTION_REPOSITORY = Symbol('BAAS_CONNECTION_REPOSITORY');

export interface ConnectionRepository {
  findById(id: string): Promise<StoredConnection | undefined>;
}

export interface ResolvedConnection {
  id: string;
  environment: Environment;
  provider: string;
  baseUrl?: string;
  config: Record<string, unknown>;
  credentials: ProviderCredentials;
  credentialsVersion: number;
}

interface CacheEntry {
  value: ResolvedConnection;
  expiresAtMs: number;
}

/**
 * Resolve e descriptografa credenciais de conexao.
 *
 * O plaintext e cacheado apenas EM PROCESSO e por 60 segundos. Nunca no Redis:
 * um cache compartilhado transforma um comprometimento do Redis em
 * comprometimento de todas as credenciais de provedor de uma vez.
 *
 * A chave de cache inclui a versao da credencial, entao rotacionar invalida
 * por construcao, sem invalidacao explicita em lugar nenhum.
 */
@Injectable()
export class CredentialResolver {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs = 60_000;

  constructor(
    @Inject(CONNECTION_REPOSITORY) private readonly repository: ConnectionRepository,
    private readonly crypto: EnvelopeCrypto,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async resolve(connectionId: string): Promise<ResolvedConnection> {
    const stored = await this.repository.findById(connectionId);
    if (!stored) {
      throw new BaasError(BaasErrorCode.CONNECTION_NOT_FOUND, {
        message: `Conexao '${connectionId}' nao encontrada.`,
      });
    }

    if (stored.status === 'DISABLED') {
      throw new BaasError(BaasErrorCode.CONNECTION_NOT_FOUND, {
        message: `Conexao '${connectionId}' esta desabilitada.`,
      });
    }
    if (stored.status === 'INVALID_CREDENTIALS') {
      throw new BaasError(BaasErrorCode.PROVIDER_CREDENTIALS_INVALID, {
        message: `As credenciais da conexao '${connectionId}' foram marcadas como invalidas.`,
      });
    }

    const cacheKey = `${connectionId}:v${stored.credentials.version}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAtMs > this.clock.now().getTime()) return cached.value;

    const credentials = await this.crypto.decryptJson<ProviderCredentials>(
      {
        ciphertext: stored.credentials.ciphertext,
        iv: stored.credentials.iv,
        authTag: stored.credentials.tag,
        wrappedKey: stored.credentials.wrappedKey,
        keyId: stored.credentials.keyId,
        version: stored.credentials.version,
      },
      `conn:${connectionId}`,
    );

    const resolved: ResolvedConnection = {
      id: stored.id,
      environment: stored.environment,
      provider: stored.provider,
      baseUrl: stored.baseUrl ?? undefined,
      config: stored.config,
      credentials,
      credentialsVersion: stored.credentials.version,
    };

    this.cache.set(cacheKey, {
      value: resolved,
      expiresAtMs: this.clock.now().getTime() + this.ttlMs,
    });
    return resolved;
  }

  async webhookSecret(connectionId: string): Promise<string | undefined> {
    const stored = await this.repository.findById(connectionId);
    if (!stored?.webhookSecret) return undefined;
    return this.crypto.decryptToString(
      {
        ciphertext: stored.webhookSecret.ciphertext,
        iv: stored.webhookSecret.iv,
        authTag: stored.webhookSecret.tag,
        wrappedKey: stored.webhookSecret.wrappedKey,
        keyId: stored.webhookSecret.keyId,
        version: 1,
      },
      `whsec:${connectionId}`,
    );
  }

  invalidate(connectionId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${connectionId}:`)) this.cache.delete(key);
    }
    this.crypto.invalidate(`conn:${connectionId}`);
  }
}
