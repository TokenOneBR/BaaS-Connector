import { COMMON_ERROR_MAPPINGS, type ErrorMapping } from '@baasconn/adapter-kit';
import { BaasErrorCode } from '@baasconn/taxonomy';

/**
 * Matriz de erros do Mock Bank.
 *
 * Mais especifico primeiro. Toda fixture em `test/fixtures/errors/` precisa
 * mapear para algo diferente do fallback `PROVIDER_REJECTED` — e assim que a
 * tabela nao apodrece quando o provedor acrescenta um codigo.
 *
 * O `safeToRetry` merece atencao: `MB-SALDO-001` e deterministico e reenviar
 * so gasta chamada, enquanto `MB-CHAOS-500` pode ter acontecido DEPOIS de o
 * pagamento ser aceito — por isso ele nao e seguro para retry automatico,
 * mesmo sendo 5xx.
 */
export const errorMappings: readonly ErrorMapping[] = [
  {
    when: { code: 'MB-AUTH-401' },
    to: BaasErrorCode.PROVIDER_CREDENTIALS_INVALID,
    retryable: false,
    safeToRetry: false,
  },
  {
    when: { code: 'MB-CONTA-404' },
    to: BaasErrorCode.ACCOUNT_NOT_FOUND,
    retryable: false,
    safeToRetry: true,
  },
  {
    when: { code: 'MB-CONTA-002' },
    to: BaasErrorCode.ACCOUNT_NOT_ACTIVE,
    retryable: false,
    safeToRetry: true,
  },
  {
    when: { code: 'MB-DOC-001' },
    to: BaasErrorCode.INVALID_TAX_ID,
    retryable: false,
    safeToRetry: true,
  },
  {
    when: { code: ['MB-DOC-422', 'MB-ONB-422'] },
    to: BaasErrorCode.VALIDATION_ERROR,
    retryable: false,
    safeToRetry: true,
  },
  {
    when: { code: 'MB-ONB-404' },
    to: BaasErrorCode.RESOURCE_NOT_FOUND,
    retryable: false,
    safeToRetry: true,
  },
  {
    when: { code: 'MB-SALDO-001' },
    to: BaasErrorCode.INSUFFICIENT_FUNDS,
    retryable: false,
    safeToRetry: true,
    details: (body) => {
      const available = (body as { error?: { details?: { available_cents?: string } } })?.error
        ?.details?.available_cents;
      return available === undefined
        ? undefined
        : [{ field: 'amount', message: `Saldo disponivel: ${available} centavos.` }];
    },
  },
  {
    when: { code: 'MB-LIMITE-001' },
    to: BaasErrorCode.LIMIT_EXCEEDED,
    retryable: false,
    safeToRetry: true,
  },
  {
    when: { code: 'MB-DICT-404' },
    to: BaasErrorCode.PIX_KEY_NOT_FOUND,
    retryable: false,
    safeToRetry: true,
  },
  {
    when: { code: 'MB-DICT-409' },
    to: BaasErrorCode.PIX_KEY_ALREADY_EXISTS,
    retryable: false,
    safeToRetry: true,
  },
  {
    when: { code: 'MB-DICT-422' },
    to: BaasErrorCode.INVALID_PIX_KEY,
    retryable: false,
    safeToRetry: true,
  },
  {
    when: { code: 'MB-TX-404' },
    to: BaasErrorCode.TRANSACTION_NOT_FOUND,
    retryable: false,
    safeToRetry: true,
  },
  {
    when: { code: 'MB-COB-404' },
    to: BaasErrorCode.CHARGE_NOT_FOUND,
    retryable: false,
    safeToRetry: true,
  },
  {
    when: { code: 'MB-COB-409' },
    to: BaasErrorCode.RESOURCE_ALREADY_EXISTS,
    retryable: false,
    safeToRetry: true,
  },
  {
    when: { code: 'MB-COB-422' },
    to: BaasErrorCode.INVALID_STATE_TRANSITION,
    retryable: false,
    safeToRetry: true,
  },
  {
    when: { code: ['MB-DEVOL-001', 'MB-DEVOL-002'] },
    to: BaasErrorCode.REFUND_WINDOW_EXPIRED,
    retryable: false,
    safeToRetry: true,
  },
  {
    // Injecao de caos: 429 e 503 sao provadamente pre-commit, entao retry e
    // seguro. O 500 nao e — pode ter acontecido depois do aceite.
    when: { code: 'MB-CHAOS-FORCED', status: 429 },
    to: BaasErrorCode.PROVIDER_RATE_LIMITED,
    retryable: true,
    safeToRetry: true,
  },
  {
    when: { code: ['MB-CHAOS-FORCED', 'MB-CHAOS-RANDOM'], status: 503 },
    to: BaasErrorCode.PROVIDER_UNAVAILABLE,
    retryable: true,
    safeToRetry: true,
  },
  {
    when: { code: ['MB-CHAOS-500', 'MB-CHAOS-FORCED'], status: 500 },
    to: BaasErrorCode.PROVIDER_INTERNAL_ERROR,
    retryable: false,
    safeToRetry: false,
  },
  ...COMMON_ERROR_MAPPINGS,
];
