import { runConformanceSuite } from '@baasconn/conformance';

import { celcoinFactory } from '../src/index.js';

import { errors, happyPath } from './fixtures/index.js';

runConformanceSuite({
  factory: celcoinFactory,
  credentials: {
    clientId: 'cliente-de-conformidade',
    clientSecret: 'segredo-de-conformidade-nao-e-real',
  },
  fixtures: { happyPath, errors },
});
