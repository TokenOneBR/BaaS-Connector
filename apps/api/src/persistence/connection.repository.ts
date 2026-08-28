import type { Environment } from '@baasconn/taxonomy';
import { Injectable } from '@nestjs/common';

import type { ConnectionRepository, StoredConnection } from '../providers/credential.resolver.js';
import type { ConnectionLookup } from '../providers/provider.registry.js';

import { PrismaService } from './prisma.service.js';

/**
 * Conexoes de provedor sobre Prisma.
 *
 * Implementa tambem o `ConnectionLookup`: o registry so precisa do slug, e
 * uma leitura que nao carrega ciphertext e a diferenca entre resolver a
 * capacidade num guard barato e descriptografar credencial para responder 501.
 */
@Injectable()
export class PrismaConnectionRepository implements ConnectionRepository, ConnectionLookup {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<StoredConnection | undefined> {
    const row = await this.prisma.client.providerConnection.findUnique({ where: { id } });
    if (!row) return undefined;

    return {
      id: row.id,
      environment: row.environment as Environment,
      provider: row.provider,
      status: row.status,
      baseUrl: row.baseUrl,
      config: (row.config ?? {}) as Record<string, unknown>,
      credentials: {
        ciphertext: Buffer.from(row.credentialsCiphertext),
        iv: Buffer.from(row.credentialsIv),
        tag: Buffer.from(row.credentialsTag),
        wrappedKey: Buffer.from(row.credentialsWrappedKey),
        keyId: row.credentialsKeyId,
        version: row.credentialsVersion,
      },
      webhookSecret:
        row.webhookSecretCiphertext &&
        row.webhookSecretIv &&
        row.webhookSecretTag &&
        row.webhookSecretWrappedKey &&
        row.webhookSecretKeyId
          ? {
              ciphertext: Buffer.from(row.webhookSecretCiphertext),
              iv: Buffer.from(row.webhookSecretIv),
              tag: Buffer.from(row.webhookSecretTag),
              wrappedKey: Buffer.from(row.webhookSecretWrappedKey),
              keyId: row.webhookSecretKeyId,
            }
          : null,
    };
  }

  async slugOf(connectionId: string): Promise<string | undefined> {
    const row = await this.prisma.client.providerConnection.findUnique({
      where: { id: connectionId },
      select: { provider: true },
    });
    return row?.provider;
  }
}
