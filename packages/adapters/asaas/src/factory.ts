import type { ProviderAdapterFactory, ProviderContext } from '@baasconn/provider-spi';

import { AsaasAdapter } from './adapter.js';
import { credentialsSchema } from './credentials.js';
import { endpoints } from './endpoints.js';
import { asaasManifest } from './manifest.js';

export const asaasFactory: ProviderAdapterFactory = {
  slug: 'ASAAS',
  displayName: 'Asaas',
  manifest: asaasManifest,
  credentialsSchema,
  endpoints,
  idempotency: {},
  docsUrl: 'https://github.com/TokenOneBR/BaaS-Connector/blob/main/docs/providers/asaas.md',
  create: (ctx: ProviderContext) => new AsaasAdapter(ctx),
};
