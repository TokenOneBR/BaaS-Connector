import { runConformanceSuite } from '@baasconn/conformance';

import { mockbankFactory } from '../src/index.js';

import { errors, happyPath, webhooks } from './fixtures/index.js';

runConformanceSuite({
  factory: mockbankFactory,
  credentials: {
    clientId: 'conformance-client',
    clientSecret: 'super-secret-client-secret',
  },
  fixtures: { happyPath, errors, webhooks: [...webhooks] },
});
