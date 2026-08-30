import { buildErrorMapper, HttpClient } from '@baasconn/adapter-kit';
import type {
  BalanceFacet,
  HealthReport,
  PixKeysFacet,
  ProviderAdapter,
  ProviderContext,
} from '@baasconn/provider-spi';

import { buildAuthStrategy } from './auth.js';
import { credentialsSchema, type AsaasCredentials } from './credentials.js';
import { paths } from './endpoints.js';
import { errorMappings } from './errors.js';
import { buildBalanceFacet, buildPixKeysFacet } from './facets/index.js';
import { redaction } from './redaction.js';

export class AsaasAdapter implements ProviderAdapter {
  readonly slug = 'ASAAS';
  readonly displayName = 'Asaas';

  readonly balance: BalanceFacet;
  readonly pixKeys: PixKeysFacet;

  private readonly client: HttpClient;

  constructor(private readonly ctx: ProviderContext) {
    const credentials = parseCredentials(ctx);

    this.client = new HttpClient({
      baseUrl: ctx.baseUrl,
      providerSlug: 'ASAAS',
      environment: ctx.environment,
      connectionId: ctx.connectionId,
      auth: buildAuthStrategy(credentials),
      errorMapper: buildErrorMapper(errorMappings),
      clock: ctx.runtime.clock,
      breaker: ctx.runtime.breaker,
      redaction,
      // O Asaas exige um User-Agent que identifique a aplicacao, e recusa
      // requisicao sem ele em producao.
      userAgent: 'BaaS-Connector (+https://github.com/TokenOneBR/BaaS-Connector)',
      correlationId: ctx.correlationId,
      operationId: ctx.operationId,
      signal: ctx.signal,
      onCall: (record) => ctx.runtime.recordCall(record),
    });

    this.balance = buildBalanceFacet(this.client, () => ctx.runtime.clock.now().toISOString());
    this.pixKeys = buildPixKeysFacet(this.client);
  }

  async health(): Promise<HealthReport> {
    const checkedAt = this.ctx.runtime.clock.now().toISOString();
    try {
      await this.client.request({ method: 'GET', path: paths.balance, endpointClass: 'read' });
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

function parseCredentials(ctx: ProviderContext): AsaasCredentials {
  const parsed = credentialsSchema.safeParse(ctx.credentials);
  return parsed.success ? parsed.data : { apiKey: '' };
}
