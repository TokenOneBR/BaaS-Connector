import type { Environment } from '@baasconn/taxonomy';
import { Injectable } from '@nestjs/common';

import type {
  ConnectionRepository,
  ConnectionSummary,
  CreateConnectionInput,
  StoredConnection,
} from '../providers/credential.resolver.js';
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
    return row ? toStored(row) : undefined;
  }

  async listActive(): Promise<StoredConnection[]> {
    const rows = await this.prisma.client.providerConnection.findMany({
      where: { status: { in: ['ACTIVE', 'DEGRADED'] } },
      orderBy: { id: 'asc' },
    });
    return rows.map(toStored);
  }

  /**
   * `select` EXPLICITO, sem uma unica coluna de envelope.
   *
   * Segunda camada da garantia: mesmo que o mapper errasse, as colunas de
   * ciphertext nao chegam a sair do Postgres. Ha teste que afirma o conjunto
   * de chaves deste `select`, entao acrescentar coluna ao schema nao alarga a
   * leitura em silencio.
   */
  private static readonly SUMMARY_SELECT = {
    id: true,
    environment: true,
    provider: true,
    label: true,
    status: true,
    baseUrl: true,
    config: true,
    capabilities: true,
    credentialsFingerprint: true,
    credentialsLast4: true,
    credentialsUpdatedAt: true,
    credentialsUpdatedBy: true,
    webhookSecretKeyId: true,
    lastHealthCheckAt: true,
    lastHealthStatus: true,
    createdAt: true,
  } as const;

  async listSummaries(environment: Environment): Promise<ConnectionSummary[]> {
    const rows = await this.prisma.client.providerConnection.findMany({
      where: { environment },
      select: PrismaConnectionRepository.SUMMARY_SELECT,
      orderBy: { id: 'asc' },
    });
    return rows.map(toSummary);
  }

  async findSummary(environment: Environment, id: string): Promise<ConnectionSummary | undefined> {
    const row = await this.prisma.client.providerConnection.findFirst({
      where: { id, environment },
      select: PrismaConnectionRepository.SUMMARY_SELECT,
    });
    return row ? toSummary(row) : undefined;
  }

  async create(input: CreateConnectionInput): Promise<ConnectionSummary> {
    const row = await this.prisma.client.providerConnection.create({
      data: {
        id: input.id,
        environment: input.environment,
        provider: input.provider as never,
        label: input.label,
        status: 'PENDING_VALIDATION',
        baseUrl: input.baseUrl,
        config: input.config as never,
        // Snapshot do manifesto: a interface le capacidade sem depender de o
        // adapter estar compilado no processo que responde.
        capabilities: input.capabilities as never,
        credentialsCiphertext: required(input.credentials.ciphertext),
        credentialsIv: required(input.credentials.iv),
        credentialsTag: required(input.credentials.tag),
        credentialsWrappedKey: required(input.credentials.wrappedKey),
        credentialsKeyId: input.credentials.keyId,
        credentialsFingerprint: input.credentialsFingerprint,
        credentialsLast4: input.credentialsLast4,
        credentialsUpdatedAt: input.at,
        credentialsUpdatedBy: input.actorId,
        webhookSecretCiphertext: bytes(input.webhookSecret?.ciphertext),
        webhookSecretIv: bytes(input.webhookSecret?.iv),
        webhookSecretTag: bytes(input.webhookSecret?.tag),
        webhookSecretWrappedKey: bytes(input.webhookSecret?.wrappedKey),
        webhookSecretKeyId: input.webhookSecret?.keyId,
      },
      select: PrismaConnectionRepository.SUMMARY_SELECT,
    });
    return toSummary(row);
  }

  async rotateCredentials(
    input: Parameters<ConnectionRepository['rotateCredentials']>[0],
  ): Promise<ConnectionSummary | undefined> {
    const updated = await this.prisma.client.providerConnection.updateMany({
      where: { id: input.id, environment: input.environment },
      data: {
        credentialsCiphertext: required(input.credentials.ciphertext),
        credentialsIv: required(input.credentials.iv),
        credentialsTag: required(input.credentials.tag),
        credentialsWrappedKey: required(input.credentials.wrappedKey),
        credentialsKeyId: input.credentials.keyId,
        // Incrementa: e o que invalida a DEK em cache por construcao, sem
        // depender de alguem lembrar de limpar cache na rotacao.
        credentialsVersion: { increment: 1 },
        credentialsFingerprint: input.credentialsFingerprint,
        credentialsLast4: input.credentialsLast4,
        credentialsUpdatedAt: input.at,
        credentialsUpdatedBy: input.actorId,
        rotatedAt: input.at,
        ...(input.webhookSecret
          ? {
              webhookSecretCiphertext: required(input.webhookSecret.ciphertext),
              webhookSecretIv: required(input.webhookSecret.iv),
              webhookSecretTag: required(input.webhookSecret.tag),
              webhookSecretWrappedKey: required(input.webhookSecret.wrappedKey),
              webhookSecretKeyId: input.webhookSecret.keyId,
            }
          : {}),
      },
    });
    if (updated.count === 0) return undefined;
    return this.findSummary(input.environment, input.id);
  }

  async updateSettings(
    input: Parameters<ConnectionRepository['updateSettings']>[0],
  ): Promise<ConnectionSummary | undefined> {
    const updated = await this.prisma.client.providerConnection.updateMany({
      // `environment` no `where`, nunca so o id: um `update` por id sozinho
      // deixaria uma sessao de homologacao alterar conexao de producao.
      where: { id: input.id, environment: input.environment },
      data: {
        label: input.label,
        baseUrl: input.baseUrl,
        config: input.config as never,
        status: input.status as never,
      },
    });
    if (updated.count === 0) return undefined;
    return this.findSummary(input.environment, input.id);
  }

  async recordHealth(id: string, healthy: boolean, at: Date): Promise<void> {
    await this.prisma.client.providerConnection.update({
      where: { id },
      data: { lastHealthCheckAt: at, lastHealthStatus: healthy ? 'HEALTHY' : 'UNHEALTHY' },
    });
  }

  async slugOf(connectionId: string): Promise<string | undefined> {
    const row = await this.prisma.client.providerConnection.findUnique({
      where: { id: connectionId },
      select: { provider: true },
    });
    return row?.provider;
  }
}

type ConnectionRow = NonNullable<
  Awaited<ReturnType<PrismaService['client']['providerConnection']['findUnique']>>
>;

function toStored(row: ConnectionRow): StoredConnection {
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

/** Linha SEM envelope para o resumo do console. */
export function toSummary(row: {
  id: string;
  environment: string;
  provider: string;
  label: string;
  status: string;
  baseUrl: string | null;
  config: unknown;
  capabilities: unknown;
  credentialsFingerprint: string | null;
  credentialsLast4: string | null;
  credentialsUpdatedAt: Date | null;
  credentialsUpdatedBy: string | null;
  webhookSecretKeyId: string | null;
  lastHealthCheckAt: Date | null;
  lastHealthStatus: string | null;
  createdAt: Date;
}): ConnectionSummary {
  return {
    id: row.id,
    environment: row.environment as Environment,
    provider: row.provider,
    label: row.label,
    status: row.status,
    baseUrl: row.baseUrl,
    config: (row.config ?? {}) as Record<string, unknown>,
    capabilities: (row.capabilities ?? {}) as Record<string, unknown>,
    credentials: {
      // Ha credencial gravada sempre — a coluna e NOT NULL. O que este bloco
      // publica e a PROVA de que ha, nunca o valor.
      set: true,
      fingerprint: row.credentialsFingerprint ?? undefined,
      last4: row.credentialsLast4 ?? undefined,
      updatedAt: row.credentialsUpdatedAt ?? undefined,
      updatedBy: row.credentialsUpdatedBy ?? undefined,
    },
    webhookSecretSet: row.webhookSecretKeyId !== null,
    lastHealthCheckAt: row.lastHealthCheckAt ?? undefined,
    lastHealthStatus: row.lastHealthStatus ?? undefined,
    createdAt: row.createdAt,
  };
}

function required(value: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value);
}

/**
 * O Prisma tipa `Bytes` como `Uint8Array<ArrayBuffer>`.
 *
 * `Buffer` e subclasse de `Uint8Array`, mas com `ArrayBufferLike`, que admite
 * `SharedArrayBuffer` — e o TypeScript recusa a atribuicao. A copia resolve e
 * e barata: sao dezenas de bytes de envelope, nao o payload.
 */
function bytes(value: Buffer | undefined): Uint8Array<ArrayBuffer> | undefined {
  return value ? new Uint8Array(value) : undefined;
}
