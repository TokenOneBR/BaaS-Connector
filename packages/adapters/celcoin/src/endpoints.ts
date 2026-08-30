/**
 * Bases da Celcoin.
 *
 * A suite de conformidade verifica que os dois DIFEREM: homologacao apontando
 * para producao e como se faz uma transferencia real achando que era teste.
 *
 * Fonte: https://developers.celcoin.com.br/docs/obtendo-acesso-as-apis
 */
export const endpoints = {
  HOMOLOGACAO: 'https://sandbox.openfinance.celcoin.dev',
  PRODUCAO: 'https://api.openfinance.celcoin.com.br',
} as const;

/**
 * Caminhos, num lugar so.
 *
 * A Celcoin nao tem um prefixo unico: onboarding vive sob `/baas-onboarding`,
 * o core banking sob `/baas`, o PIX de recebimento sob `/pix`, e o token na
 * raiz. Espalhar isso pelas facetas e como um prefixo errado sobrevive a
 * revisao — aqui a inconsistencia fica visivel de uma vez.
 */
export const paths = {
  token: '/v5/token',
  accountPf: '/baas-onboarding/v1/account/natural-person/create',
  accountPj: '/baas-onboarding/v1/account/business/create',
  proposal: '/baas-onboarding/v1/account/proposal',
  dictEntry: '/baas/v2/pix/dict/entry',
  dictExternal: '/baas/v2/pix/dict/entry/external',
  pixPayment: '/baas/v2/pix/payment',
  brcodeStatic: '/pix/v1/brcode/static',
  collectionImmediate: '/pix/v1/collection/immediate',
} as const;
