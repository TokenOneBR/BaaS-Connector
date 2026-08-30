import { generateKeyPairSync } from 'node:crypto';

import { runConformanceSuite } from '@baasconn/conformance';

import { qitechFactory } from '../src/index.js';

import { errors, happyPath } from './fixtures/index.js';

// Par gerado no teste: nada de chave commitada, e o `check-cassette-pii` do CI
// recusa bloco PEM em fixture — com razao.
const { privateKey, publicKey } = generateKeyPairSync('ec', {
  namedCurve: 'P-521',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

runConformanceSuite({
  factory: qitechFactory,
  credentials: {
    apiKey: 'chave-de-conformidade-nao-e-real',
    privateKey,
    providerPublicKey: publicKey,
    keyId: 'conformance',
  },
  fixtures: { happyPath, errors },
});
