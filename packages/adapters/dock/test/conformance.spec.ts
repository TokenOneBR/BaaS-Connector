import { runConformanceSuite } from '@baasconn/conformance';

import { dockFactory } from '../src/index.js';

import { errors, happyPath } from './fixtures/index.js';

runConformanceSuite({
  factory: dockFactory,
  credentials: {
    clientId: 'cliente-de-conformidade',
    clientSecret: 'segredo-de-conformidade-nao-e-real',
  },
  fixtures: { happyPath, errors },
});
