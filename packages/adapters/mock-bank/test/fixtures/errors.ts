import type { Cassette } from '@baasconn/adapter-kit/testing';

/**
 * Matriz de erros.
 *
 * O nome do cenario decide qual chamada a suite dispara — ela casa por
 * SUBSTRING: `balance`, `account`, `key`, `charge`, `statement`, `onboarding`,
 * e qualquer outra coisa vira `pixTransfers.get`. Renomear um cenario aqui
 * muda silenciosamente o que esta sendo testado.
 *
 * Toda interacao >= 400 precisa virar um BaasError que NAO seja o fallback
 * `PROVIDER_REJECTED` — e assim que a tabela de mapeamento nao apodrece quando
 * o provedor acrescenta um codigo novo.
 */
const ACCOUNT_ID = 'conformance-account';
const REUSABLE = 1000;

const token: Cassette = {
  provider: 'MOCK_BANK',
  scenario: 'auth-token-errors',
  source: 'sandbox',
  interactions: [
    {
      request: { method: 'POST', path: '/api/v1/auth/token' },
      response: {
        status: 200,
        body: {
          access_token: 'token-de-conformidade-nao-e-segredo',
          token_type: 'Bearer',
          expires_in: 900,
        },
      },
      maxUses: REUSABLE,
    },
  ],
};

export const errors: readonly Cassette[] = [
  token,
  {
    provider: 'MOCK_BANK',
    scenario: 'account-nao-encontrada',
    source: 'sandbox',
    interactions: [
      {
        request: { method: 'GET', path: `/api/v1/contas/${ACCOUNT_ID}` },
        response: {
          status: 404,
          body: { error: { code: 'MB-CONTA-404', message: 'Conta nao encontrada.' } },
        },
      },
    ],
  },
  {
    provider: 'MOCK_BANK',
    scenario: 'balance-conta-inativa',
    source: 'sandbox',
    interactions: [
      {
        request: { method: 'GET', path: `/api/v1/contas/${ACCOUNT_ID}/saldo` },
        response: {
          status: 400,
          body: { error: { code: 'MB-CONTA-002', message: 'Conta nao esta ativa.' } },
        },
      },
    ],
  },
  {
    provider: 'MOCK_BANK',
    scenario: 'key-chave-nao-encontrada',
    source: 'sandbox',
    interactions: [
      {
        request: { method: 'GET', path: `/api/v1/contas/${ACCOUNT_ID}/chaves` },
        response: {
          status: 404,
          body: { error: { code: 'MB-DICT-404', message: 'Chave nao encontrada no DICT.' } },
        },
      },
    ],
  },
  {
    provider: 'MOCK_BANK',
    scenario: 'charge-nao-encontrada',
    source: 'sandbox',
    interactions: [
      {
        request: { method: 'GET', path: '/api/v1/cobrancas/conformance-txid' },
        response: {
          status: 404,
          body: { error: { code: 'MB-COB-404', message: 'Cobranca nao encontrada.' } },
        },
      },
    ],
  },
  {
    provider: 'MOCK_BANK',
    scenario: 'onboarding-nao-encontrado',
    source: 'sandbox',
    interactions: [
      {
        request: { method: 'GET', path: `/api/v1/contas/${ACCOUNT_ID}/onboarding` },
        response: {
          status: 404,
          body: { error: { code: 'MB-ONB-404', message: 'Onboarding nao encontrado.' } },
        },
      },
    ],
  },
  {
    provider: 'MOCK_BANK',
    scenario: 'statement-indisponivel',
    source: 'sandbox',
    interactions: [
      {
        request: {
          method: 'GET',
          path: `/api/v1/contas/${ACCOUNT_ID}/extrato?data_inicio=2026-08-01&data_fim=2026-08-28`,
        },
        response: {
          status: 503,
          body: { error: { code: 'MB-CHAOS-RANDOM', message: 'Instabilidade simulada.' } },
        },
        // 503 e retentavel: o kit tenta de novo, entao a fixture precisa
        // servir a mesma resposta mais de uma vez.
        maxUses: REUSABLE,
      },
    ],
  },
  {
    provider: 'MOCK_BANK',
    scenario: 'transacao-nao-encontrada',
    source: 'sandbox',
    interactions: [
      {
        request: { method: 'GET', path: '/api/v1/pix/conformance-tx' },
        response: {
          status: 404,
          body: { error: { code: 'MB-TX-404', message: 'Transacao nao encontrada.' } },
        },
      },
    ],
  },
];
