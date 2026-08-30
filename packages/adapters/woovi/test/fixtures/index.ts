import type { Cassette } from '@baasconn/adapter-kit/testing';

const DOCS = 'https://developers.woovi.com/en/docs/charge/how-to-create-charge-using-api';
const REUSABLE = 1000;

const CHARGE = {
  correlationID: 'conformance-txid',
  status: 'ACTIVE',
  // Centavos INTEIROS: a Woovi ja fala a unidade do nosso dominio.
  value: 150075,
  brCode:
    '00020101021226770014br.gov.bcb.pix2555api.woovi.com/pix/conformance5204000053039865802BR5913Loja Exemplo6009Sao Paulo62070503***6304ABCD',
  qrCodeImage: 'https://api.woovi.com/openpix/charge/brcode/image/conformance.png',
  createdAt: '2026-08-28T10:00:00.000Z',
  expiresDate: '2026-08-29T10:00:00.000Z',
};

export const happyPath: readonly Cassette[] = [
  {
    provider: 'WOOVI',
    scenario: 'company-health',
    source: 'handcrafted-from-docs',
    docsRef: DOCS,
    interactions: [
      {
        request: { method: 'GET', path: '/api/v1/company' },
        response: { status: 200, body: { company: { name: 'Loja Exemplo' } } },
        maxUses: REUSABLE,
      },
    ],
  },
  {
    provider: 'WOOVI',
    scenario: 'charge-get',
    source: 'handcrafted-from-docs',
    docsRef: DOCS,
    interactions: [
      {
        request: { method: 'GET', path: '/api/openpix/v1/charge/conformance-txid' },
        response: { status: 200, body: { charge: CHARGE } },
        maxUses: REUSABLE,
      },
    ],
  },
  {
    provider: 'WOOVI',
    scenario: 'charge-list',
    source: 'handcrafted-from-docs',
    docsRef: DOCS,
    interactions: [
      {
        request: { method: 'GET', path: '/api/openpix/v1/charge' },
        response: {
          status: 200,
          body: { charges: [CHARGE], pageInfo: { skip: 0, limit: 10, hasNextPage: false } },
        },
        maxUses: REUSABLE,
      },
    ],
  },
];

/**
 * A Woovi nao usa rota de token, entao NAO ha cassete de auth para isolar —
 * o `Authorization: <AppID>` vai em toda chamada e nao precisa de round-trip
 * proprio. E por isso que esta lista comeca direto no erro.
 */
export const errors: readonly Cassette[] = [
  {
    provider: 'WOOVI',
    scenario: 'charge-inexistente',
    source: 'handcrafted-from-docs',
    docsRef: DOCS,
    interactions: [
      {
        request: { method: 'GET', path: '/api/openpix/v1/charge/conformance-txid' },
        response: { status: 404, body: { error: 'Charge not found' } },
      },
    ],
  },
  {
    provider: 'WOOVI',
    scenario: 'charge-appid-invalido',
    source: 'handcrafted-from-docs',
    docsRef: DOCS,
    interactions: [
      {
        request: { method: 'GET', path: '/api/openpix/v1/charge' },
        response: { status: 401, body: { error: 'Invalid AppID' } },
      },
    ],
  },
];
