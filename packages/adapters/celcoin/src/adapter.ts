import type { HttpClient } from '@baasconn/adapter-kit';
import type {
  AccountsFacet,
  BalanceFacet,
  HealthReport,
  OnboardingFacet,
  PixKeysFacet,
  PixTransfersFacet,
  ProviderAdapter,
  ProviderContext,
} from '@baasconn/provider-spi';

import { buildClient } from './client.js';
import { credentialsSchema, type CelcoinCredentials } from './credentials.js';
import {
  buildAccountsFacet,
  buildBalanceFacet,
  buildOnboardingFacet,
  buildPixKeysFacet,
  buildPixTransfersFacet,
} from './facets/index.js';

export class CelcoinAdapter implements ProviderAdapter {
  readonly slug = 'CELCOIN';
  readonly displayName = 'Celcoin';

  readonly accounts: AccountsFacet;
  readonly onboarding: OnboardingFacet;
  readonly balance: BalanceFacet;
  readonly pixKeys: PixKeysFacet;
  readonly pixTransfers: PixTransfersFacet;

  private readonly client: HttpClient;

  constructor(private readonly ctx: ProviderContext) {
    const credentials = parseCredentials(ctx);
    this.client = buildClient(ctx, credentials);

    this.accounts = buildAccountsFacet(this.client);
    this.onboarding = buildOnboardingFacet(this.client);
    this.balance = buildBalanceFacet(this.client, () => ctx.runtime.clock.now().toISOString());
    this.pixKeys = buildPixKeysFacet(this.client);
    this.pixTransfers = buildPixTransfersFacet(this.client);
  }

  async health(): Promise<HealthReport> {
    // Sonda barata, e NUNCA no readiness do Kubernetes: a Celcoin ter uma
    // tarde ruim nao pode tirar nossos pods de servico.
    const startedAt = this.ctx.runtime.clock.now();
    try {
      await this.client.request({ method: 'GET', path: '/baas/v2/account', endpointClass: 'read' });
      return { healthy: true, checkedAt: startedAt.toISOString() };
    } catch (error) {
      return {
        healthy: false,
        checkedAt: startedAt.toISOString(),
        message: error instanceof Error ? error.message : 'falha desconhecida',
      };
    }
  }
}

/**
 * Credenciais toleran­tes a vazio, de proposito.
 *
 * `ProviderRegistry.onModuleInit` constroi TODO adapter no boot com
 * `credentials: {}` para validar o manifesto contra as facetas expostas. Um
 * `parse` estrito aqui derrubaria a API na subida — e a validacao de verdade
 * acontece no cadastro da conexao, que e onde um segredo faltando ainda e um
 * erro de configuracao em vez de um incidente.
 */
function parseCredentials(ctx: ProviderContext): CelcoinCredentials {
  const parsed = credentialsSchema.safeParse(ctx.credentials);
  return parsed.success ? parsed.data : { clientId: '', clientSecret: '' };
}
