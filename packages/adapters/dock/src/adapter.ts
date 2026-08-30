import { buildErrorMapper, HttpClient } from '@baasconn/adapter-kit';
import type { HealthReport, ProviderAdapter, ProviderContext } from '@baasconn/provider-spi';

import { buildAuthStrategy } from './auth.js';
import { credentialsSchema, type DockCredentials } from './credentials.js';
import { errorMappings } from './errors.js';
import { redaction } from './redaction.js';

export class DockAdapter implements ProviderAdapter {
  readonly slug = 'DOCK';
  readonly displayName = 'Dock';

  private readonly client: HttpClient;

  constructor(private readonly ctx: ProviderContext) {
    const credentials = parseCredentials(ctx);

    this.client = new HttpClient({
      baseUrl: ctx.baseUrl,
      providerSlug: 'DOCK',
      environment: ctx.environment,
      connectionId: ctx.connectionId,
      auth: buildAuthStrategy(ctx, credentials),
      errorMapper: buildErrorMapper(errorMappings),
      clock: ctx.runtime.clock,
      breaker: ctx.runtime.breaker,
      redaction,
      correlationId: ctx.correlationId,
      operationId: ctx.operationId,
      signal: ctx.signal,
      onCall: (record) => ctx.runtime.recordCall(record),
    });
  }

  /**
   * Health check que exercita a AUTENTICACAO, que e o que este adapter tem.
   *
   * Nao e simbolico: obter token prova credencial valida, host alcancavel e
   * TLS negociado — que sao as tres coisas que quebram primeiro numa conexao
   * recem-cadastrada.
   */
  async health(): Promise<HealthReport> {
    const checkedAt = this.ctx.runtime.clock.now().toISOString();
    try {
      await this.client.request({ method: 'GET', path: '/', endpointClass: 'read' });
      return { healthy: true, checkedAt };
    } catch (error) {
      return {
        healthy: false,
        checkedAt,
        message: error instanceof Error ? error.message : 'falha desconhecida',
      };
    }
  }
}

function parseCredentials(ctx: ProviderContext): DockCredentials {
  const parsed = credentialsSchema.safeParse(ctx.credentials);
  return parsed.success ? parsed.data : { clientId: '', clientSecret: '' };
}
