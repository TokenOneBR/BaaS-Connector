import { buildErrorMapper, HttpClient } from '@baasconn/adapter-kit';
import type {
  HealthReport,
  PixChargesFacet,
  ProviderAdapter,
  ProviderContext,
} from '@baasconn/provider-spi';

import { buildAuthStrategy } from './auth.js';
import { credentialsSchema, type WooviCredentials } from './credentials.js';
import { paths } from './endpoints.js';
import { errorMappings } from './errors.js';
import { buildPixChargesFacet } from './facets/index.js';
import { redaction } from './redaction.js';

export class WooviAdapter implements ProviderAdapter {
  readonly slug = 'WOOVI';
  readonly displayName = 'Woovi';

  readonly pixCharges: PixChargesFacet;

  private readonly client: HttpClient;

  constructor(private readonly ctx: ProviderContext) {
    const credentials = parseCredentials(ctx);

    this.client = new HttpClient({
      baseUrl: ctx.baseUrl,
      providerSlug: 'WOOVI',
      environment: ctx.environment,
      connectionId: ctx.connectionId,
      auth: buildAuthStrategy(credentials),
      errorMapper: buildErrorMapper(errorMappings),
      clock: ctx.runtime.clock,
      breaker: ctx.runtime.breaker,
      redaction,
      correlationId: ctx.correlationId,
      operationId: ctx.operationId,
      signal: ctx.signal,
      onCall: (record) => ctx.runtime.recordCall(record),
    });

    this.pixCharges = buildPixChargesFacet(this.client);
  }

  async health(): Promise<HealthReport> {
    const checkedAt = this.ctx.runtime.clock.now().toISOString();
    try {
      await this.client.request({ method: 'GET', path: paths.company, endpointClass: 'read' });
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

/** Ver o adapter da Celcoin: o boot constroi com credenciais vazias. */
function parseCredentials(ctx: ProviderContext): WooviCredentials {
  const parsed = credentialsSchema.safeParse(ctx.credentials);
  return parsed.success ? parsed.data : { appId: '' };
}
