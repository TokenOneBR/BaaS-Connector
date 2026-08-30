import type { ProviderAdapterFactory, ProviderContext } from '@baasconn/provider-spi';

import { DockAdapter } from './adapter.js';
import { credentialsSchema } from './credentials.js';
import { endpoints } from './endpoints.js';
import { dockManifest } from './manifest.js';

export const dockFactory: ProviderAdapterFactory = {
  slug: 'DOCK',
  displayName: 'Dock',
  manifest: dockManifest,
  credentialsSchema,
  endpoints,
  idempotency: {},
  docsUrl: 'https://github.com/TokenOneBR/BaaS-Connector/blob/main/docs/providers/dock.md',
  create: (ctx: ProviderContext) => new DockAdapter(ctx),
};
