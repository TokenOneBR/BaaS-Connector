import type { Cassette } from '@baasconn/adapter-kit/testing';
import type {
  ProviderAdapterFactory,
  ProviderContext,
  ProviderCredentials,
} from '@baasconn/provider-spi';
import type { CapabilityKey } from '@baasconn/taxonomy';

export interface ConformanceFixtures {
  /** Cassetes de caminho feliz, uma por capacidade declarada. */
  happyPath: readonly Cassette[];
  /**
   * Cassetes de erro. Todo codigo de erro que aparece aqui precisa mapear para
   * algo diferente do fallback: e assim que a tabela de mapeamento nao apodrece.
   */
  errors: readonly Cassette[];
  /** Payloads de webhook, com assinatura valida. */
  webhooks?: readonly {
    name: string;
    body: string;
    headers: Record<string, string>;
    secret: string;
    expectedEventTypes: readonly string[];
  }[];
}

export interface ConformanceConfig {
  factory: ProviderAdapterFactory;
  credentials: ProviderCredentials;
  fixtures: ConformanceFixtures;
  /** Capacidades a pular, com justificativa obrigatoria. */
  skip?: Partial<Record<CapabilityKey, string>>;
  /** Referencia de conta usada nas chamadas do teste. */
  accountRef?: { providerAccountId: string; branch?: string; number?: string };
  /** Permite ao adapter customizar o contexto (config nao secreta). */
  buildContext?: (base: ProviderContext) => ProviderContext;
}
