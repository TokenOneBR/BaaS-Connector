import type { Cassette } from '@baasconn/adapter-kit/testing';

const DOCS = 'https://docs.asaas.com/docs/pix';
const REUSABLE = 1000;

export const happyPath: readonly Cassette[] = [
  {
    provider: 'ASAAS',
    scenario: 'balance-get',
    source: 'handcrafted-from-docs',
    docsRef: 'https://docs.asaas.com/reference/recuperar-saldo-da-conta',
    interactions: [
      {
        request: { method: 'GET', path: '/v3/finance/balance' },
        // Decimal em numero JSON, como a Celcoin.
        response: { status: 200, body: { balance: 1500.75 } },
        maxUses: REUSABLE,
      },
    ],
  },
  {
    provider: 'ASAAS',
    scenario: 'pix-key-list',
    source: 'handcrafted-from-docs',
    docsRef: DOCS,
    interactions: [
      {
        request: { method: 'GET', path: '/v3/pix/addressKeys' },
        response: {
          status: 200,
          body: {
            data: [
              {
                id: 'evp_conformance_1',
                key: 'b0000000-0000-4000-8000-000000000001',
                type: 'EVP',
                status: 'ACTIVE',
                dateCreated: '2026-08-02T09:00:00Z',
              },
            ],
            hasMore: false,
            limit: 10,
            offset: 0,
            totalCount: 1,
          },
        },
        maxUses: REUSABLE,
      },
    ],
  },
];

export const errors: readonly Cassette[] = [
  {
    provider: 'ASAAS',
    scenario: 'balance-saldo-insuficiente',
    source: 'handcrafted-from-docs',
    docsRef: DOCS,
    interactions: [
      {
        request: { method: 'GET', path: '/v3/finance/balance' },
        // Status 400 com codigo especifico: o Asaas usa 400 para quase tudo,
        // entao mapear por status transformaria "sem saldo" em "payload
        // invalido" e o cliente tentaria corrigir o corpo.
        response: {
          status: 400,
          body: { errors: [{ code: 'insufficient_balance', description: 'Saldo insuficiente' }] },
        },
      },
    ],
  },
  {
    provider: 'ASAAS',
    scenario: 'pix-key-chave-invalida',
    source: 'handcrafted-from-docs',
    docsRef: DOCS,
    interactions: [
      {
        request: { method: 'GET', path: '/v3/pix/addressKeys' },
        response: {
          status: 400,
          body: { errors: [{ code: 'invalid_addressKey', description: 'Chave invalida' }] },
        },
      },
    ],
  },
];
