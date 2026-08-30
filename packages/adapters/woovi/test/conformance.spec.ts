import { runConformanceSuite } from '@baasconn/conformance';

import { wooviFactory } from '../src/index.js';

import { errors, happyPath } from './fixtures/index.js';

runConformanceSuite({
  factory: wooviFactory,
  credentials: { appId: 'appid-de-conformidade-nao-e-real' },
  fixtures: { happyPath, errors },
});
