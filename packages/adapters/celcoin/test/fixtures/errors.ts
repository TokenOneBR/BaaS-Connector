import type { Cassette } from '@baasconn/adapter-kit/testing';

const DOCS = 'https://developers.celcoin.com.br/docs/tabela-de-erros-mapeados';
const REUSABLE = 1000;

/**
 * Cenarios de erro.
 *
 * Duas regras da suite decidem a forma deste arquivo:
 *
 * 1. O nome do cenario e despachado por SUBSTRING, nesta ordem: `balance`,
 *    `account`, `key`, `charge`, `statement`, `onboarding`, senao
 *    `pixTransfers.get`. Renomear um cenario muda silenciosamente qual faceta
 *    e exercitada — e um cenario chamado `account-key-invalida` casaria
 *    `account` primeiro, testando a faceta errada.
 *
 * 2. Ao isolar uma cassete de erro a suite inclui junto as cassetes cujas
 *    interacoes sao TODAS < 400, para servir a autenticacao. Sem a cassete de
 *    token aqui, cada teste de erro mediria uma falha de autenticacao em vez
 *    do erro que pretendia medir.
 */
export const errors: readonly Cassette[] = [
  {
    provider: 'CELCOIN',
    scenario: 'auth-token-errors',
    source: 'handcrafted-from-docs',
    docsRef: DOCS,
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
    scenario: 'account-nao-encontrada',
    source: 'handcrafted-from-docs',
    docsRef: DOCS,
    interactions: [
      {
        request: { method: 'GET', path: '/baas/v2/account' },
        response: {
          status: 404,
          body: {
            status: 'ERROR',
            error: { errorCode: 'CBE037', message: 'Conta nao localizada' },
          },
        },
      },
    ],
  },
  {
    provider: 'CELCOIN',
    scenario: 'balance-sem-autorizacao',
    source: 'handcrafted-from-docs',
    docsRef: DOCS,
    interactions: [
      {
        request: { method: 'GET', path: '/baas/v2/account/balance' },
        response: {
          status: 403,
          body: { status: 'ERROR', error: { errorCode: 'CBE009', message: 'Acesso negado' } },
        },
      },
    ],
  },
  {
    provider: 'CELCOIN',
    scenario: 'pix-key-inexistente-no-dict',
    source: 'handcrafted-from-docs',
    docsRef: DOCS,
    interactions: [
      {
        request: { method: 'GET', path: '/baas/v2/pix/dict/entry' },
        response: {
          status: 404,
          // CBE063 e especifico da matriz deste adapter: mapeia para
          // PIX_KEY_NOT_FOUND em vez do RESOURCE_NOT_FOUND generico do 404.
          body: {
            status: 'ERROR',
            error: { errorCode: 'CBE063', message: 'Chave nao encontrada no DICT' },
          },
        },
      },
    ],
  },
  {
    provider: 'CELCOIN',
    scenario: 'pix-payment-saldo-insuficiente',
    source: 'handcrafted-from-docs',
    docsRef: DOCS,
    interactions: [
      {
        request: { method: 'GET', path: '/baas/v2/pix/payment' },
        response: {
          status: 400,
          body: {
            status: 'ERROR',
            error: { errorCode: 'CBE072', message: 'Saldo insuficiente' },
          },
        },
      },
    ],
  },
  {
    provider: 'CELCOIN',
    scenario: 'onboarding-proposta-invalida',
    source: 'handcrafted-from-docs',
    docsRef: DOCS,
    interactions: [
      {
        request: { method: 'GET', path: '/baas-onboarding/v1/account/proposal' },
        response: {
          status: 400,
          body: {
            status: 'ERROR',
            error: { errorCode: 'CBE110', message: 'Documento invalido' },
          },
        },
      },
    ],
  },
];
