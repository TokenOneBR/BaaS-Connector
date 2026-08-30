import type { Environment } from '@baasconn/taxonomy';

import type {
  ConnectionRepository,
  ConnectionSummary,
  CreateConnectionInput,
  StoredConnection,
} from '../../providers/credential.resolver.js';

/**
 * Dobro de conexoes.
 *
 * Guarda o envelope junto com o resumo, mas os metodos de resumo NUNCA o
 * devolvem — a mesma separacao que o Prisma faz por `select`. Se o dobro
 * vazasse a credencial onde o real nao vaza, o teste que existe para provar a
 * ausencia de vazamento estaria medindo o dobro, e nao o produto.
 */
export class MemoryConnectionRepository implements ConnectionRepository {
  readonly rows = new Map<string, StoredConnection & { summary: ConnectionSummary }>();

  async findById(id: string): Promise<StoredConnection | undefined> {
    const row = this.rows.get(id);
    if (!row) return undefined;
    const { summary: _summary, ...stored } = row;
    return stored;
  }

  async listActive(): Promise<StoredConnection[]> {
    const ativos = [...this.rows.values()].filter(
      (row) => row.status === 'ACTIVE' || row.status === 'DEGRADED',
    );
    return ativos.map(({ summary: _summary, ...stored }) => stored);
  }

  async listSummaries(environment: Environment): Promise<ConnectionSummary[]> {
    return [...this.rows.values()]
      .filter((row) => row.environment === environment)
      .map((row) => row.summary);
  }

  async findSummary(environment: Environment, id: string): Promise<ConnectionSummary | undefined> {
    const row = this.rows.get(id);
    return row?.environment === environment ? row.summary : undefined;
  }

  async create(input: CreateConnectionInput): Promise<ConnectionSummary> {
    const summary: ConnectionSummary = {
      id: input.id,
      environment: input.environment,
      provider: input.provider,
      label: input.label,
      status: 'PENDING_VALIDATION',
      baseUrl: input.baseUrl,
      config: input.config,
      capabilities: input.capabilities,
      credentials: {
        set: true,
        fingerprint: input.credentialsFingerprint,
        last4: input.credentialsLast4,
        updatedAt: input.at,
        updatedBy: input.actorId,
      },
      webhookSecretSet: input.webhookSecret !== undefined,
      createdAt: input.at,
    };

    this.rows.set(input.id, {
      id: input.id,
      environment: input.environment,
      provider: input.provider,
      status: 'PENDING_VALIDATION',
      baseUrl: input.baseUrl,
      config: input.config,
      credentials: input.credentials,
      webhookSecret: input.webhookSecret ?? null,
      summary,
    });

    return summary;
  }

  async rotateCredentials(
    input: Parameters<ConnectionRepository['rotateCredentials']>[0],
  ): Promise<ConnectionSummary | undefined> {
    const row = this.rows.get(input.id);
    if (!row || row.environment !== input.environment) return undefined;

    row.credentials = input.credentials;
    if (input.webhookSecret) row.webhookSecret = input.webhookSecret;
    row.summary = {
      ...row.summary,
      credentials: {
        set: true,
        fingerprint: input.credentialsFingerprint,
        last4: input.credentialsLast4,
        updatedAt: input.at,
        updatedBy: input.actorId,
      },
      webhookSecretSet: row.webhookSecret !== null,
    };
    return row.summary;
  }

  async updateSettings(
    input: Parameters<ConnectionRepository['updateSettings']>[0],
  ): Promise<ConnectionSummary | undefined> {
    const row = this.rows.get(input.id);
    if (!row || row.environment !== input.environment) return undefined;

    if (input.label !== undefined) row.summary.label = input.label;
    if (input.baseUrl !== undefined) row.baseUrl = row.summary.baseUrl = input.baseUrl;
    if (input.config !== undefined) row.config = row.summary.config = input.config;
    if (input.status !== undefined) row.status = row.summary.status = input.status;
    return row.summary;
  }

  async recordHealth(id: string, healthy: boolean, at: Date): Promise<void> {
    const row = this.rows.get(id);
    if (!row) return;
    row.summary.lastHealthCheckAt = at;
    row.summary.lastHealthStatus = healthy ? 'HEALTHY' : 'UNHEALTHY';
  }
}
