/**
 * Bases do Asaas.
 *
 * Fonte: https://docs.asaas.com/docs/autenticacao
 */
export const endpoints = {
  HOMOLOGACAO: 'https://api-sandbox.asaas.com',
  PRODUCAO: 'https://api.asaas.com',
} as const;

export const paths = {
  payment: '/v3/payments',
  pixKey: '/v3/pix/addressKeys',
  transfer: '/v3/transfers',
  balance: '/v3/finance/balance',
} as const;
