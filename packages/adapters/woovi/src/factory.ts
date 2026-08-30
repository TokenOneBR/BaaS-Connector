import type { ProviderAdapterFactory, ProviderContext } from '@baasconn/provider-spi';

import { WooviAdapter } from './adapter.js';
import { credentialsSchema } from './credentials.js';
import { endpoints } from './endpoints.js';
import { wooviManifest } from './manifest.js';

export const wooviFactory: ProviderAdapterFactory = {
  slug: 'WOOVI',
  displayName: 'Woovi',
  manifest: wooviManifest,
  credentialsSchema,
  endpoints,
  idempotency: {
    // `correlationID` no corpo, nao header: repetir o mesmo valor devolve a
    // cobranca existente em vez de criar outra.
    'pix.charge.create': { mode: 'body_field', path: 'correlationID' },
  },
  // Identificador, nao segredo: pode ter os ultimos 4 exibidos.
  credentialsDisplayField: 'appId',
  docsUrl: 'https://github.com/TokenOneBR/BaaS-Connector/blob/main/docs/providers/woovi.md',
  create: (ctx: ProviderContext) => new WooviAdapter(ctx),
};
