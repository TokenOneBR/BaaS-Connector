import type { HttpClient } from '@baasconn/adapter-kit';
import type {
  AccountsFacet,
  BalanceFacet,
  HealthReport,
  OnboardingFacet,
  PixChargesFacet,
  PixKeysFacet,
  PixTransfersFacet,
  ProviderAdapter,
  ProviderContext,
  StatementFacet,
  WebhookFacet,
} from '@baasconn/provider-spi';

import { buildClient } from './client.js';
import { credentialsSchema, type MockBankCredentials } from './credentials.js';
import { buildAccountsFacet } from './facets/accounts.js';
import { buildBalanceFacet } from './facets/balance.js';
import { buildOnboardingFacet } from './facets/onboarding.js';
import { buildPixChargesFacet } from './facets/pix-charges.js';
import { buildPixKeysFacet } from './facets/pix-keys.js';
import { buildPixTransfersFacet } from './facets/pix-transfers.js';
import { buildStatementFacet } from './facets/statement.js';
import { buildWebhooksFacet } from './facets/webhooks.js';

/**
 * Adapter do Mock Bank.
 *
 * O construtor e BARATO de proposito — sem I/O, sem fetch de token: `create()`
 * roda por operacao logica, e um construtor que faz rede transformaria cada
 * chamada em duas. O token so e buscado na primeira requisicao, e o TokenStore
 * do kit coalesce as concorrentes.
 */
export class MockBankAdapter implements ProviderAdapter {
  readonly slug = 'MOCK_BANK';
  readonly displayName = 'Mock Bank';

  readonly accounts: AccountsFacet;
  readonly onboarding: OnboardingFacet;
  readonly balance: BalanceFacet;
  readonly pixKeys: PixKeysFacet;
  readonly pixCharges: PixChargesFacet;
  readonly pixTransfers: PixTransfersFacet;
  readonly statement: StatementFacet;
  readonly webhooks: WebhookFacet;

  private readonly client: HttpClient;

  constructor(private readonly ctx: ProviderContext) {
    const credentials = parseCredentials(ctx);
    this.client = buildClient(ctx, credentials);

    this.accounts = buildAccountsFacet(this.client);
    this.onboarding = buildOnboardingFacet(this.client);
    this.balance = buildBalanceFacet(this.client);
    this.pixKeys = buildPixKeysFacet(this.client);
    this.pixCharges = buildPixChargesFacet(this.client);
    this.pixTransfers = buildPixTransfersFacet(this.client);
    this.statement = buildStatementFacet(this.client);
    this.webhooks = buildWebhooksFacet();
  }

  /**
   * Sonda barata.
   *
   * NUNCA entra no readiness do Kubernetes: o provedor ter uma tarde ruim nao
   * pode tirar nossos pods de servico. Aparece em /admin/v1/providers e como
   * metrica de estado de circuito.
   */
  async health(): Promise<HealthReport> {
    const startedAt = this.ctx.runtime.clock.now();
    try {
      await this.client.request({ method: 'GET', path: '/healthz', endpointClass: 'read' });
      return {
        healthy: true,
        latencyMs: this.ctx.runtime.clock.now().getTime() - startedAt.getTime(),
        checkedAt: this.ctx.runtime.clock.now().toISOString(),
      };
    } catch (error) {
      return {
        healthy: false,
        message: error instanceof Error ? error.message : 'falha desconhecida',
        checkedAt: this.ctx.runtime.clock.now().toISOString(),
      };
    }
  }
}

/**
 * Credenciais validadas na construcao.
 *
 * O `credentialsSchema` ja roda no cadastro, antes de cifrar. Revalidar aqui
 * cobre o caso de uma linha antiga no banco de antes de um campo virar
 * obrigatorio — e falhar com mensagem clara e melhor do que um `undefined`
 * chegando ao corpo da requisicao.
 */
function parseCredentials(ctx: ProviderContext): MockBankCredentials {
  const parsed = credentialsSchema.safeParse(ctx.credentials);
  if (parsed.success) return parsed.data;

  // Na validacao de manifesto do boot as credenciais sao um objeto vazio de
  // proposito: o adapter precisa ser construivel sem elas.
  return { clientId: '', clientSecret: '' };
}
