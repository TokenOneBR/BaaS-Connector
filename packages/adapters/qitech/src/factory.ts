import type { ProviderAdapterFactory, ProviderContext } from '@baasconn/provider-spi';

import { QitechAdapter } from './adapter.js';
import { credentialsSchema } from './credentials.js';
import { endpoints } from './endpoints.js';
import { qitechManifest } from './manifest.js';

export const qitechFactory: ProviderAdapterFactory = {
  slug: 'QITECH',
  displayName: 'QI Tech',
  manifest: qitechManifest,
  credentialsSchema,
  endpoints,
  idempotency: {},
  docsUrl: 'https://github.com/TokenOneBR/BaaS-Connector/blob/main/docs/providers/qitech.md',
  create: (ctx: ProviderContext) => new QitechAdapter(ctx),
};
