import type { ProviderAdapterFactory, ProviderContext } from '@baasconn/provider-spi';

import { CelcoinAdapter } from './adapter.js';
import { credentialsSchema } from './credentials.js';
import { endpoints } from './endpoints.js';
import { celcoinManifest } from './manifest.js';

export const celcoinFactory: ProviderAdapterFactory = {
  slug: 'CELCOIN',
  displayName: 'Celcoin',
  manifest: celcoinManifest,
  credentialsSchema,
  endpoints,
  idempotency: {
    // A Celcoin NAO tem header de idempotencia: quem deduplica e o
    // `clientCode` no corpo. `mode: 'external_id'` faz o conector mandar o
    // mesmo `operationId` no retry, e e por isso que `findByIdempotencyKey`
    // precisa existir — sem ele a escada do desfecho desconhecido nao teria
    // primeira tentativa.
    'pix.out': { mode: 'external_id' },
    'accounts.create': { mode: 'external_id' },
  },
  // Identificador, nao segredo: pode ter os ultimos 4 exibidos.
  credentialsDisplayField: 'clientId',
  docsUrl: 'https://github.com/TokenOneBR/BaaS-Connector/blob/main/docs/providers/celcoin.md',
  create: (ctx: ProviderContext) => new CelcoinAdapter(ctx),
};
