import { AsymmetricJwtStrategy, buildErrorMapper, HttpClient } from '@baasconn/adapter-kit';
import type { HealthReport, ProviderAdapter, ProviderContext } from '@baasconn/provider-spi';

import { buildAuthStrategy } from './auth.js';
import { credentialsSchema, type QiTechCredentials } from './credentials.js';
import { errorMappings } from './errors.js';
import { redaction } from './redaction.js';

export class QitechAdapter implements ProviderAdapter {
  readonly slug = 'QITECH';
  readonly displayName = 'QI Tech';

  private readonly client: HttpClient;
  private readonly credentials: QiTechCredentials;

  constructor(private readonly ctx: ProviderContext) {
    this.credentials = parseCredentials(ctx);

    this.client = new HttpClient({
      baseUrl: ctx.baseUrl,
      providerSlug: 'QITECH',
      environment: ctx.environment,
      connectionId: ctx.connectionId,
      auth: buildAuthStrategy(this.credentials),
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
   * Verifica a assinatura de uma resposta da QI Tech.
   *
   * Metade do contrato deste provedor vive aqui. Aceitar resposta nao
   * verificada anularia o motivo de a assinatura existir: um intermediario
   * poderia reescrever o corpo de uma confirmacao de pagamento e nos
   * acreditariamos. LANCA quando nao confere — nunca devolve `false`, porque
   * um chamador que ignora o booleano e indistinguivel de um que nao verificou.
   */
  async verifyResponse(jws: string): Promise<Record<string, unknown>> {
    if (!this.credentials.providerPublicKey) {
      throw new Error(
        'Conexao QI Tech sem `providerPublicKey`: nao ha como verificar a resposta do provedor.',
      );
    }
    return AsymmetricJwtStrategy.verifyResponse(jws, this.credentials.providerPublicKey, 'ES512');
  }

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

function parseCredentials(ctx: ProviderContext): QiTechCredentials {
  const parsed = credentialsSchema.safeParse(ctx.credentials);
  return parsed.success ? parsed.data : { apiKey: '', privateKey: '' };
}
