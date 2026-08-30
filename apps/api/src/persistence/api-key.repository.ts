import { EnvelopeCrypto } from '@baasconn/crypto';
import type { Environment } from '@baasconn/taxonomy';
import { Injectable } from '@nestjs/common';

import type { ApiKeyRecord, ApiKeyRepository, CreateApiKeyRow } from '../auth/api-key.service.js';

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

  /**
   * `select` explicito, sem `secretHash` nem `secretLookup`.
   *
   * O segredo nunca foi recuperavel — o que fica gravado e um hash Argon2id —,
   * mas nem o hash sai daqui: publica-lo daria a quem lesse a listagem um alvo
   * offline, e nao ha razao para o console conhece-lo.
   */
  private static readonly RECORD_SELECT = {
    id: true,
    environment: true,
    name: true,
    prefix: true,
    last4: true,
    scopes: true,
    signingRequired: true,
    ipAllowlist: true,
    rateLimitTier: true,
    defaultConnectionId: true,
    status: true,
    lastUsedAt: true,
    expiresAt: true,
    createdAt: true,
  } as const;

  async list(environment: Environment, status?: string): Promise<ApiKeyRecord[]> {
    const rows = await this.prisma.client.apiKey.findMany({
      where: { environment, status: status as never },
      select: PrismaApiKeyRepository.RECORD_SELECT,
      orderBy: { id: 'desc' },
    });
    return rows.map(toApiKeyRecord);
  }

  async findById(environment: Environment, id: string): Promise<ApiKeyRecord | undefined> {
    const row = await this.prisma.client.apiKey.findFirst({
      where: { id, environment },
      select: PrismaApiKeyRepository.RECORD_SELECT,
    });
    return row ? toApiKeyRecord(row) : undefined;
  }

  async create(input: CreateApiKeyRow): Promise<ApiKeyRecord> {
    const row = await this.prisma.client.apiKey.create({
      data: {
        id: input.id,
        environment: input.environment,
        name: input.name,
        prefix: input.prefix,
        last4: input.last4,
        secretHash: input.secretHash,
        secretLookup: bytesOf(input.secretLookup),
        scopes: input.scopes,
        signingRequired: input.signingRequired,
        signingSecretCiphertext: optionalBytes(input.signingSecret?.ciphertext),
        signingSecretIv: optionalBytes(input.signingSecret?.iv),
        signingSecretTag: optionalBytes(input.signingSecret?.tag),
        signingSecretWrappedKey: optionalBytes(input.signingSecret?.wrappedKey),
        signingSecretKeyId: input.signingSecret?.keyId,
        ipAllowlist: input.ipAllowlist,
        expiresAt: input.expiresAt,
        createdBy: input.createdBy,
        // Spread condicional: `defaultConnectionId: undefined` faria o Prisma
        // escolher a variante "checked" do create, onde a FK so entra por
        // `connect`. Ausente, ele usa a "unchecked" e aceita o id direto.
        ...(input.defaultConnectionId
          ? { defaultConnection: { connect: { id: input.defaultConnectionId } } }
          : {}),
      },
      select: PrismaApiKeyRepository.RECORD_SELECT,
    });
    return toApiKeyRecord(row);
  }

  async revoke(environment: Environment, id: string, at: Date): Promise<ApiKeyRecord | undefined> {
    const updated = await this.prisma.client.apiKey.updateMany({
      // `environment` no `where`: revogar por id sozinho deixaria uma sessao
      // de homologacao derrubar uma chave de producao.
      where: { id, environment, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: at },
    });
    if (updated.count === 0) return undefined;
    return this.findById(environment, id);
  }
}

function toApiKeyRecord(row: {
  id: string;
  environment: string;
  name: string;
  prefix: string;
  last4: string;
  scopes: string[];
  signingRequired: boolean;
  ipAllowlist: string[];
  rateLimitTier: string;
  defaultConnectionId: string | null;
  status: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}): ApiKeyRecord {
  return {
    id: row.id,
    environment: row.environment as Environment,
    name: row.name,
    prefix: row.prefix,
    last4: row.last4,
    scopes: row.scopes,
    signingRequired: row.signingRequired,
    ipAllowlist: row.ipAllowlist,
    rateLimitTier: row.rateLimitTier,
    defaultConnectionId: row.defaultConnectionId ?? undefined,
    status: row.status,
    lastUsedAt: row.lastUsedAt ?? undefined,
    expiresAt: row.expiresAt ?? undefined,
    createdAt: row.createdAt,
  };
}

/** `Buffer` e `Uint8Array<ArrayBufferLike>`; o Prisma exige `<ArrayBuffer>`. */
function bytesOf(value: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value);
}

function optionalBytes(value: Buffer | undefined): Uint8Array<ArrayBuffer> | undefined {
  return value ? new Uint8Array(value) : undefined;
}
