import { EnvelopeCrypto } from '@baasconn/crypto';
import { Injectable } from '@nestjs/common';

import type {
  ConsoleRole,
  ConsoleSessionRepository,
  ConsoleUserRecord,
  ConsoleUserRepository,
  SessionRecord,
} from '../admin/admin.types.js';

import { PrismaService } from './prisma.service.js';

@Injectable()
export class PrismaConsoleUserRepository implements ConsoleUserRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: EnvelopeCrypto,
  ) {}

  async findByEmail(email: string): Promise<ConsoleUserRecord | undefined> {
    const row = await this.prisma.client.consoleUser.findUnique({ where: { email } });
    return row ? this.toRecord(row) : undefined;
  }

  async findById(id: string): Promise<ConsoleUserRecord | undefined> {
    const row = await this.prisma.client.consoleUser.findUnique({ where: { id } });
    return row ? this.toRecord(row) : undefined;
  }

  async touchLogin(id: string, at: Date): Promise<void> {
    await this.prisma.client.consoleUser.update({ where: { id }, data: { lastLoginAt: at } });
  }

  private async toRecord(row: {
    id: string;
    email: string;
    name: string;
    passwordHash: string | null;
    role: string;
    mfaEnabled: boolean;
    status: string;
    totpSecretCiphertext: Uint8Array | null;
    totpSecretIv: Uint8Array | null;
    totpSecretTag: Uint8Array | null;
    totpSecretWrappedKey: Uint8Array | null;
    totpSecretKeyId: string | null;
  }): Promise<ConsoleUserRecord> {
    let totpSecret: string | undefined;
    if (
      row.totpSecretCiphertext &&
      row.totpSecretIv &&
      row.totpSecretTag &&
      row.totpSecretWrappedKey &&
      row.totpSecretKeyId
    ) {
      // O segredo TOTP e material de autenticacao: fica cifrado em envelope,
      // como credencial de provedor, e nao em coluna legivel.
      totpSecret = await this.crypto.decryptToString(
        {
          ciphertext: Buffer.from(row.totpSecretCiphertext),
          iv: Buffer.from(row.totpSecretIv),
          authTag: Buffer.from(row.totpSecretTag),
          wrappedKey: Buffer.from(row.totpSecretWrappedKey),
          keyId: row.totpSecretKeyId,
          version: 1,
        },
        `totp:${row.id}`,
      );
    }

    return {
      id: row.id,
      email: row.email,
      name: row.name,
      passwordHash: row.passwordHash,
      role: row.role as ConsoleRole,
      mfaEnabled: row.mfaEnabled,
      totpSecret,
      status: row.status,
    };
  }
}

@Injectable()
export class PrismaConsoleSessionRepository implements ConsoleSessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    id: string;
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<void> {
    await this.prisma.client.consoleSession.create({
      data: {
        id: input.id,
        userId: input.userId,
        refreshTokenHash: input.refreshTokenHash,
        expiresAt: input.expiresAt,
        userAgent: input.userAgent?.slice(0, 512),
        ipAddress: input.ipAddress,
      },
    });
  }

  async findById(id: string): Promise<SessionRecord | undefined> {
    const row = await this.prisma.client.consoleSession.findUnique({ where: { id } });
    return row
      ? {
          id: row.id,
          userId: row.userId,
          refreshTokenHash: row.refreshTokenHash,
          expiresAt: row.expiresAt,
          revokedAt: row.revokedAt,
        }
      : undefined;
  }

  /**
   * Rotaciona o refresh token.
   *
   * O `WHERE revokedAt IS NULL` faz a rotacao ser condicional no banco: duas
   * abas renovando ao mesmo tempo nao produzem dois tokens validos, e a
   * segunda recebe `false` em vez de sobrescrever a primeira.
   */
  async rotate(id: string, refreshTokenHash: string, expiresAt: Date): Promise<boolean> {
    const result = await this.prisma.client.consoleSession.updateMany({
      where: { id, revokedAt: null },
      data: { refreshTokenHash, expiresAt },
    });
    return result.count === 1;
  }

  async revoke(id: string, at: Date): Promise<void> {
    await this.prisma.client.consoleSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: at },
    });
  }

  async revokeAllForUser(userId: string, at: Date): Promise<void> {
    await this.prisma.client.consoleSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: at },
    });
  }
}
