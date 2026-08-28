import { EnvelopeCrypto } from '@baasconn/crypto';
import type { Environment } from '@baasconn/taxonomy';
import { Injectable } from '@nestjs/common';

import type { ApiKeyRepository } from '../auth/api-key.service.js';

import { PrismaService } from './prisma.service.js';

/**
 * Repositorio de API keys sobre Prisma.
 *
 * A busca e por `secretLookup`, um sha256 indexado. Sem ele, autenticar
 * exigiria rodar Argon2id contra cada linha da tabela ate achar a chave — e
 * Argon2id e caro DE PROPOSITO, entao isso seria um DoS auto-infligido.
 */
@Injectable()
export class PrismaApiKeyRepository implements ApiKeyRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: EnvelopeCrypto,
  ) {}

  async findByLookup(lookup: Buffer): Promise<
    | {
        id: string;
        name: string;
        environment: Environment;
        scopes: string[];
        secretHash: string;
        signingRequired: boolean;
        signingSecret?: string;
        defaultConnectionId?: string;
        ipAllowlist: string[];
        rateLimitTier: string;
        status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
        expiresAt?: Date | null;
      }
    | undefined
  > {
    // Copia para Uint8Array: o `Buffer` do Node 22 e tipado sobre
    // ArrayBufferLike, e o Prisma exige ArrayBuffer. A copia tambem garante
    // que o Prisma nao enxergue um slice de um pool reaproveitado.
    const row = await this.prisma.client.apiKey.findFirst({
      where: { secretLookup: new Uint8Array(lookup) },
    });
    if (!row) return undefined;

    let signingSecret: string | undefined;
    if (
      row.signingSecretCiphertext &&
      row.signingSecretIv &&
      row.signingSecretTag &&
      row.signingSecretWrappedKey &&
      row.signingSecretKeyId
    ) {
      signingSecret = await this.crypto.decryptToString(
        {
          ciphertext: Buffer.from(row.signingSecretCiphertext),
          iv: Buffer.from(row.signingSecretIv),
          authTag: Buffer.from(row.signingSecretTag),
          wrappedKey: Buffer.from(row.signingSecretWrappedKey),
          keyId: row.signingSecretKeyId,
          version: 1,
        },
        `apikey:${row.id}`,
      );
    }

    return {
      id: row.id,
      name: row.name,
      environment: row.environment as Environment,
      scopes: row.scopes,
      secretHash: row.secretHash,
      signingRequired: row.signingRequired,
      signingSecret,
      defaultConnectionId: row.defaultConnectionId ?? undefined,
      ipAllowlist: row.ipAllowlist,
      rateLimitTier: row.rateLimitTier,
      status: row.status,
      expiresAt: row.expiresAt,
    };
  }

  /**
   * Atualiza `last_used_at`.
   *
   * Melhor esforco e fora do caminho critico: uma escrita por requisicao
   * autenticada nunca pode ser o motivo de a autenticacao falhar.
   */
  async touchLastUsed(id: string): Promise<void> {
    await this.prisma.client.apiKey.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }
}
