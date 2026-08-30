import { COMMON_ERROR_MAPPINGS, type ErrorMapping } from '@baasconn/adapter-kit';
import { BaasErrorCode } from '@baasconn/taxonomy';

/**
 * Matriz de erros do Asaas.
 *
 * O Asaas devolve `errors: [{ code, description }]` e usa status 400 para
 * quase tudo — inclusive saldo insuficiente. Por isso o mapeamento e por
 * CODIGO, nao por status: cair no 400 generico transformaria "sem saldo" em
 * "requisicao invalida", e o cliente tentaria corrigir o payload.
 */
export const errorMappings: readonly ErrorMapping[] = [
  {
    when: { codePath: 'errors.0.code', code: 'insufficient_balance' },
    to: BaasErrorCode.INSUFFICIENT_FUNDS,
    retryable: false,
  },
  {
    when: { codePath: 'errors.0.code', code: ['invalid_addressKey', 'invalid_pixAddressKey'] },
    to: BaasErrorCode.PIX_KEY_NOT_FOUND,
    retryable: false,
  },
  {
    when: { codePath: 'errors.0.code', code: 'invalid_action' },
    to: BaasErrorCode.VALIDATION_ERROR,
    retryable: false,
  },
  ...COMMON_ERROR_MAPPINGS,
];
