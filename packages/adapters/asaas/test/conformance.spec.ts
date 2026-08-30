import { runConformanceSuite } from '@baasconn/conformance';

import { asaasFactory } from '../src/index.js';

import { errors, happyPath } from './fixtures/index.js';

runConformanceSuite({
  factory: asaasFactory,
  credentials: { apiKey: 'chave-de-conformidade-nao-e-real' },
  fixtures: { happyPath, errors },
});
