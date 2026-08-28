import type { ProviderAdapterFactory, ProviderContext } from '@baasconn/provider-spi';

import { MockBankAdapter } from './adapter.js';
import { credentialsSchema } from './credentials.js';
import { endpoints } from './endpoints.js';
import { mockbankManifest } from './manifest.js';

export const mockbankFactory: ProviderAdapterFactory = {
  slug: 'MOCK_BANK',
  displayName: 'Mock Bank',
  manifest: mockbankManifest,
  credentialsSchema,
  endpoints,

  /**
   * O Mock Bank aceita idempotencia por cabecalho.
   *
   * O valor enviado e o nosso `operationId` (ULID), NUNCA a `Idempotency-Key`
   * do cliente: formatos arbitrarios violam regra de provedor, e as vezes
   * precisamos emitir uma SEGUNDA chamada para a mesma chave do cliente.
   */
  idempotency: {
    'pix.out': { mode: 'header', header: 'X-Idempotency-Key' },
    'pix.refund': { mode: 'header', header: 'X-Idempotency-Key' },
    'accounts.create': { mode: 'external_id' },
  },

  docsUrl: 'https://github.com/TokenOneBR/BaaS-Connector/blob/main/docs/providers/mock-bank.md',
  create: (ctx: ProviderContext) => new MockBankAdapter(ctx),
};
