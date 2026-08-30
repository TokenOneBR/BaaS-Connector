import type { Cassette } from '@baasconn/adapter-kit/testing';

const ACCOUNT = 'conformance-account';
const DOCS = 'https://developers.celcoin.com.br/docs';

/**
 * A suite reinicia o harness por grupo, e cada reinicio reexecuta as mesmas
 * interacoes. Sem um teto alto de usos, o segundo grupo nao acharia a cassete.
 */
const REUSABLE = 1000;

/**
 * `handcrafted-from-docs`, e nao `sandbox`.
 *
 * Estas fixtures foram escritas a partir da documentacao publica da Celcoin,
 * NAO gravadas contra o sandbox — o ambiente onde este adapter foi construido
 * nao tem credencial nem alcanca developers.celcoin.com.br. O relatorio de
 * conformidade publica essa diferenca, e ela importa: o que estes testes
 * provam e que os mappers sao coerentes com o que a documentacao descreve, e
 * NAO que a documentacao esta certa. Quem tiver credencial deve regravar.
 *
 * Todo documento aqui tem digito verificador INVALIDO de proposito. O gate de
 * PII recusa CPF/CNPJ valido, e os sinteticos permitidos por ele sao os mesmos
 * canarios de vazamento do grupo 9 — a intersecao das duas regras so deixa
 * documento invalido.
 */
export const happyPath: readonly Cassette[] = [
  {
    provider: 'CELCOIN',
    scenario: 'auth-token',
    source: 'handcrafted-from-docs',
    docsRef: `${DOCS}/autenticacao-1`,
    interactions: [
      {
        request: { method: 'POST', path: '/v5/token' },
        response: {
          status: 200,
          body: {
            access_token: 'token-de-conformidade-nao-e-segredo',
            token_type: 'Bearer',
            expires_in: 3600,
          },
        },
        maxUses: REUSABLE,
      },
    ],
  },
  {
    provider: 'CELCOIN',
    scenario: 'account-get',
    source: 'handcrafted-from-docs',
    docsRef: `${DOCS}/criar-conta`,
    interactions: [
      {
        request: { method: 'GET', path: '/baas/v2/account' },
        response: {
          status: 200,
          body: {
            version: '1.1.0',
            status: 'SUCCESS',
            body: {
              clientCode: ACCOUNT,
              account: '30016936',
              branch: '0001',
              documentNumber: '99999999000199',
              status: 'ACTIVE',
              createdAt: '2026-08-01T10:00:00Z',
            },
          },
        },
        maxUses: REUSABLE,
      },
    ],
  },
  {
    provider: 'CELCOIN',
    scenario: 'balance-get',
    source: 'handcrafted-from-docs',
    docsRef: `${DOCS}/sobre-o-baas`,
    interactions: [
      {
        request: { method: 'GET', path: '/baas/v2/account/balance' },
        response: {
          status: 200,
          body: {
            status: 'SUCCESS',
            // Numero JSON, nao string decimal: e a peculiaridade central do
            // wire da Celcoin, e o teste de precisao do grupo 5 depende dela.
            body: {
              amount: 1500.75,
              blockedAmount: 100.5,
              scheduledAmount: 0,
              currency: 'BRL',
              updatedAt: '2026-08-28T12:00:00Z',
            },
          },
        },
        maxUses: REUSABLE,
      },
    ],
  },
  {
    provider: 'CELCOIN',
    scenario: 'pix-key-list',
    source: 'handcrafted-from-docs',
    docsRef: `${DOCS}/gestao-de-chaves-pix-baas`,
    interactions: [
      {
        request: { method: 'GET', path: '/baas/v2/pix/dict/entry' },
        response: {
          status: 200,
          body: {
            status: 'SUCCESS',
            body: {
              listKeys: [
                {
                  key: 'a1b2c3d4-0000-4000-8000-000000000001',
                  keyType: 'EVP',
                  status: 'ACTIVE',
                  createdAt: '2026-08-02T09:00:00Z',
                  account: { participant: '13935893', branch: '0001', account: '30016936' },
                },
                {
                  key: 'recebedor@exemplo.test',
                  // A Celcoin chama de MAIL o que o BACEN chama de EMAIL.
                  keyType: 'MAIL',
                  status: 'ACTIVE',
                  createdAt: '2026-08-02T09:05:00Z',
                  account: { participant: '13935893', branch: '0001', account: '30016936' },
                },
              ],
            },
          },
        },
        maxUses: REUSABLE,
      },
    ],
  },
  {
    provider: 'CELCOIN',
    scenario: 'pix-payment-get',
    source: 'handcrafted-from-docs',
    docsRef: `${DOCS}/consultar-status-de-um-pagamento-pix`,
    interactions: [
      {
        request: { method: 'GET', path: '/baas/v2/pix/payment' },
        response: {
          status: 200,
          body: {
            status: 'SUCCESS',
            body: {
              transactionId: 'conformance-tx',
              clientCode: 'opr_conformance',
              // Formato do BACEN: E + ISPB(8) + AAAAMMDDHHmm(12) + 11 alfanum.
              // O grupo 6 valida isto contra a regra, nao contra a fixture.
              endToEndId: 'E13935893202608281030ABC12345678',
              amount: 500.25,
              status: 'CONFIRMED',
              createDate: '2026-08-28T10:30:00Z',
              lastUpdate: '2026-08-28T10:30:04Z',
              creditParty: {
                account: '10203040',
                branch: '0001',
                bank: '00000000',
                name: 'Recebedor Exemplo',
                taxId: '99999999000199',
              },
            },
          },
        },
        maxUses: REUSABLE,
      },
    ],
  },
  {
    provider: 'CELCOIN',
    scenario: 'onboarding-proposal',
    source: 'handcrafted-from-docs',
    docsRef: `${DOCS}/utilizacao-do-onboarding-celcoin`,
    interactions: [
      {
        request: { method: 'GET', path: '/baas-onboarding/v1/account/proposal' },
        response: {
          status: 200,
          body: {
            status: 'SUCCESS',
            body: {
              proposalId: 'conformance-case',
              clientCode: ACCOUNT,
              status: 'CONFIRMED',
              documentNumber: '99999999000199',
              createdAt: '2026-08-01T09:58:00Z',
            },
          },
        },
        maxUses: REUSABLE,
      },
    ],
  },
];
