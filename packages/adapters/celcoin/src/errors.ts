import { COMMON_ERROR_MAPPINGS, type ErrorMapping } from '@baasconn/adapter-kit';
import { BaasErrorCode } from '@baasconn/taxonomy';

/**
 * Matriz de erros da Celcoin.
 *
 * Mais especifico primeiro: o mapeador para no primeiro `when` que casa, entao
 * uma regra por status colocada antes de uma por codigo engoliria a segunda.
 *
 * O codigo do provedor vem em `error.errorCode` (prefixo `CBE`) e e preservado
 * literalmente no corpo do erro canonico, para escalacao com o suporte da
 * Celcoin sem precisar do log.
 *
 * Fonte: https://developers.celcoin.com.br/docs/tabela-de-erros-mapeados
 */
export const errorMappings: readonly ErrorMapping[] = [
  {
    when: { codePath: 'error.errorCode', code: ['CBE072', 'CBE073'] },
    to: BaasErrorCode.INSUFFICIENT_FUNDS,
    retryable: false,
  },
  {
    when: { codePath: 'error.errorCode', code: ['CBE063', 'CBE064'] },
    to: BaasErrorCode.PIX_KEY_NOT_FOUND,
    retryable: false,
  },
  {
    when: { codePath: 'error.errorCode', code: /^CBE1\d{2}$/ },
    to: BaasErrorCode.VALIDATION_ERROR,
    retryable: false,
  },
  // 401/403/404/409/429/5xx ja vem de COMMON_ERROR_MAPPINGS. Repetir uma
  // regra por status aqui a colocaria ANTES das especificas por codigo e
  // engoliria o `CBE***`, que e justamente o que o suporte da Celcoin pede.
  ...COMMON_ERROR_MAPPINGS,
];
