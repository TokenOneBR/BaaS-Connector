import { EnvelopeCrypto } from '@baasconn/crypto';
import type { ProviderAdapterFactory } from '@baasconn/provider-spi';
import {
  ActorType,
  BaasError,
  BaasErrorCode,
  newId,
  type Clock,
  type Environment,
} from '@baasconn/taxonomy';
import { Inject, Injectable } from '@nestjs/common';

import { CLOCK } from '../common/clock.js';
import { AUDIT_REPOSITORY, type AuditRepository } from '../events/outbox.types.js';
import {
  CONNECTION_REPOSITORY,
  CredentialResolver,
  type ConnectionRepository,
  type ConnectionSummary,
} from '../providers/credential.resolver.js';
import { ProviderRegistry } from '../providers/provider.registry.js';

export interface CreateConnectionRequest {
  environment: Environment;
  provider: string;
  label: string;
  baseUrl?: string;
  config: Record<string, unknown>;
  credentials: Record<string, unknown>;
  webhookSecret?: string;
  actorId: string;
}

@Injectable()
export class ConnectionsService {
  constructor(
    @Inject(CONNECTION_REPOSITORY) private readonly connections: ConnectionRepository,
    private readonly crypto: EnvelopeCrypto,
    private readonly registry: ProviderRegistry,
    private readonly resolver: CredentialResolver,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  list(environment: Environment): Promise<ConnectionSummary[]> {
    return this.connections.listSummaries(environment);
  }

  async get(environment: Environment, id: string): Promise<ConnectionSummary> {
    const summary = await this.connections.findSummary(environment, id);
    if (!summary) {
      throw new BaasError(BaasErrorCode.RESOURCE_NOT_FOUND, {
        message: `Conexao ${id} nao encontrada em ${environment}.`,
      });
    }
    return summary;
  }

  async create(input: CreateConnectionRequest): Promise<ConnectionSummary> {
    const factory = this.registry.factory(input.provider);

    // Valida ANTES de cifrar. Um `clientSecret` faltando detectado no cadastro
    // e erro de configuracao; detectado na primeira transferencia e incidente.
    const credentials = factory.credentialsSchema.safeParse(input.credentials);
    if (!credentials.success) {
      throw new BaasError(BaasErrorCode.VALIDATION_ERROR, {
        message: `Credenciais invalidas para ${input.provider}.`,
        details: credentials.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const now = this.clock.now();
    const id = newId('connection');
    const envelope = await this.crypto.encryptJson(credentials.data);
    const webhook = input.webhookSecret
      ? await this.crypto.encrypt(input.webhookSecret)
      : undefined;

    const summary = await this.connections.create({
      id,
      environment: input.environment,
      provider: factory.slug,
      label: input.label,
      baseUrl: input.baseUrl ?? factory.endpoints[input.environment],
      config: input.config,
      // Snapshot do manifesto: a interface le capacidade sem depender de o
      // adapter estar compilado no processo que responde.
      capabilities: factory.manifest as unknown as Record<string, unknown>,
      credentials: toStored(envelope),
      credentialsFingerprint: fingerprintOf(factory, credentials.data),
      credentialsLast4: last4Of(factory, credentials.data),
      webhookSecret: webhook ? toStored(webhook) : undefined,
      actorId: input.actorId,
      at: now,
    });

    await this.record(input.actorId, 'connection.created', summary, now, {
      provider: summary.provider,
      environment: summary.environment,
    });
    return summary;
  }

  async rotateCredentials(input: {
    environment: Environment;
    id: string;
    credentials: Record<string, unknown>;
    webhookSecret?: string;
    actorId: string;
  }): Promise<ConnectionSummary> {
    const atual = await this.get(input.environment, input.id);
    const factory = this.registry.factory(atual.provider);

    const parsed = factory.credentialsSchema.safeParse(input.credentials);
    if (!parsed.success) {
      throw new BaasError(BaasErrorCode.VALIDATION_ERROR, {
        message: `Credenciais invalidas para ${atual.provider}.`,
      });
    }

    const now = this.clock.now();
    const envelope = await this.crypto.encryptJson(parsed.data);
    const webhook = input.webhookSecret
      ? await this.crypto.encrypt(input.webhookSecret)
      : undefined;

    const summary = await this.connections.rotateCredentials({
      environment: input.environment,
      id: input.id,
      credentials: toStored(envelope),
      credentialsFingerprint: fingerprintOf(factory, parsed.data),
      credentialsLast4: last4Of(factory, parsed.data),
      webhookSecret: webhook ? toStored(webhook) : undefined,
      actorId: input.actorId,
      at: now,
    });
    if (!summary) throw new BaasError(BaasErrorCode.RESOURCE_NOT_FOUND);

    this.resolver.invalidate(input.id);

    // A auditoria grava o FINGERPRINT do antes e do depois, nunca o valor.
    // Um `before`/`after` com credencial em claro colocaria o segredo numa
    // tabela append-only que nem o dono do banco consegue apagar.
    await this.record(input.actorId, 'connection.credentials.rotated', summary, now, {
      fingerprint_before: atual.credentials.fingerprint ?? null,
      fingerprint_after: summary.credentials.fingerprint ?? null,
    });
    return summary;
  }

  async updateSettings(input: {
    environment: Environment;
    id: string;
    label?: string;
    baseUrl?: string;
    config?: Record<string, unknown>;
    status?: string;
    actorId: string;
  }): Promise<ConnectionSummary> {
    // `INVALID_CREDENTIALS` e posto pelo runtime e NAO e limpavel a mao:
    // limpa-lo por decisao de painel devolveria uma conexao quebrada ao
    // caminho de PIX sem que nada tivesse sido consertado.
    const permitidos = new Set(['ACTIVE', 'DEGRADED', 'DISABLED']);
    if (input.status !== undefined && !permitidos.has(input.status)) {
      throw new BaasError(BaasErrorCode.VALIDATION_ERROR, {
        message: `Status ${input.status} nao pode ser definido manualmente.`,
      });
    }

    const summary = await this.connections.updateSettings(input);
    if (!summary) {
      throw new BaasError(BaasErrorCode.RESOURCE_NOT_FOUND, {
        message: `Conexao ${input.id} nao encontrada em ${input.environment}.`,
      });
    }

    await this.record(input.actorId, 'connection.updated', summary, this.clock.now(), {
      label: input.label ?? null,
      status: input.status ?? null,
    });
    return summary;
  }

  private async record(
    actorId: string,
    action: string,
    summary: ConnectionSummary,
    at: Date,
    after: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record({
      environment: summary.environment,
      actorType: ActorType.USER,
      actorId,
      action,
      resourceType: 'provider_connection',
      resourceId: summary.id,
      connectionId: summary.id,
      outcome: 'SUCCESS',
      after,
      occurredAt: at,
    });
  }
}

interface Envelope {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  wrappedKey: Buffer;
  keyId: string;
  version?: number;
}

function toStored(envelope: Envelope) {
  return {
    ciphertext: envelope.ciphertext,
    iv: envelope.iv,
    tag: envelope.authTag,
    wrappedKey: envelope.wrappedKey,
    keyId: envelope.keyId,
    version: envelope.version ?? 1,
  };
}

/**
 * Impressao digital do segredo, nao o segredo.
 *
 * `sha256:<16 hex>` — prova que ha credencial gravada e permite comparar duas
 * sem revelar nenhuma. E o que a tela mostra no lugar do valor.
 */
function fingerprintOf(
  factory: ProviderAdapterFactory,
  credentials: Record<string, unknown>,
): string {
  return EnvelopeCrypto.fingerprint(JSON.stringify(credentials));
}

/**
 * Ultimos quatro caracteres do campo que o adapter declara exibivel.
 *
 * Nao ha resposta generica segura: `last4` de um `clientSecret` vaza quatro
 * caracteres de um segredo. So o adapter sabe qual credencial e um
 * IDENTIFICADOR (um `clientId`, um `appId`) em vez de um segredo, e sem essa
 * declaracao o campo fica ausente.
 */
function last4Of(
  factory: ProviderAdapterFactory,
  credentials: Record<string, unknown>,
): string | undefined {
  const field = factory.credentialsDisplayField;
  if (!field) return undefined;
  const value = credentials[field];
  return typeof value === 'string' && value.length >= 4 ? value.slice(-4) : undefined;
}
