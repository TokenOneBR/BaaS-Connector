import { BaasError, BaasErrorCode, type ProviderErrorContext } from '@baasconn/taxonomy';

export interface ErrorMatch {
  status?: number | readonly number[] | ((status: number) => boolean);
  /** Codigo do provedor, exato, lista ou regex. */
  code?: string | RegExp | readonly string[];
  /** Onde ler o codigo no corpo. Padrao: tenta caminhos comuns. */
  codePath?: string;
  messageMatch?: RegExp;
}

export interface ErrorMapping {
  when: ErrorMatch;
  to: BaasErrorCode;
  retryable?: boolean;
  safeToRetry?: boolean;
  /** Enriquecimento: puxa limite, saldo ou campo invalido para os detalhes. */
  details?: (body: unknown) => { field?: string; message: string }[] | undefined;
}

export interface MapErrorInput {
  status: number;
  body: unknown;
  providerSlug: string;
  requestId?: string;
}

const COMMON_CODE_PATHS = [
  'error.code',
  'error.errorCode',
  'errorCode',
  'code',
  'error',
  'errors.0.code',
  'data.error.code',
];

const COMMON_MESSAGE_PATHS = [
  'error.message',
  'message',
  'error_description',
  'errors.0.description',
  'errors.0.message',
  'detail',
];

function readPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, segment) => {
    if (node === null || typeof node !== 'object') return undefined;
    return (node as Record<string, unknown>)[segment];
  }, source);
}

function firstString(source: unknown, paths: readonly string[]): string | undefined {
  for (const path of paths) {
    const value = readPath(source, path);
    if (typeof value === 'string' && value.length > 0) return value;
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

export function extractProviderCode(body: unknown, codePath?: string): string | undefined {
  return codePath ? firstString(body, [codePath]) : firstString(body, COMMON_CODE_PATHS);
}

export function extractProviderMessage(body: unknown): string | undefined {
  return firstString(body, COMMON_MESSAGE_PATHS);
}

function statusMatches(match: ErrorMatch['status'], status: number): boolean {
  if (match === undefined) return true;
  if (typeof match === 'number') return match === status;
  if (typeof match === 'function') return match(status);
  return match.includes(status);
}

function codeMatches(match: ErrorMatch['code'], code: string | undefined): boolean {
  if (match === undefined) return true;
  if (code === undefined) return false;
  if (typeof match === 'string') return match === code;
  if (match instanceof RegExp) return match.test(code);
  return match.includes(code);
}

export type ErrorMapper = (input: MapErrorInput) => BaasError;

/**
 * Constroi um mapeador declarativo, avaliado em ordem.
 *
 * O fallback e `PROVIDER_REJECTED`, e um teste de conformidade exige que TODA
 * fixture de erro do adapter mapeie para algo diferente dele. E assim que a
 * tabela de mapeamento nao apodrece: um codigo novo do provedor aparece como
 * falha de teste, nao como erro generico em producao.
 */
export function buildErrorMapper(
  mappings: readonly ErrorMapping[],
  fallback: BaasErrorCode = BaasErrorCode.PROVIDER_REJECTED,
): ErrorMapper {
  return ({ status, body, providerSlug, requestId }: MapErrorInput): BaasError => {
    const code = extractProviderCode(body);
    const message = extractProviderMessage(body);

    const provider: ProviderErrorContext = {
      slug: providerSlug,
      code,
      message,
      httpStatus: status,
      requestId,
    };

    for (const mapping of mappings) {
      const { when } = mapping;
      const providerCode = when.codePath ? extractProviderCode(body, when.codePath) : code;

      if (!statusMatches(when.status, status)) continue;
      if (!codeMatches(when.code, providerCode)) continue;
      if (when.messageMatch && !(message && when.messageMatch.test(message))) continue;

      return new BaasError(mapping.to, {
        provider,
        requestId,
        retryable: mapping.retryable,
        safeToRetry: mapping.safeToRetry,
        details: mapping.details?.(body),
      });
    }

    return new BaasError(fallback, { provider, requestId });
  };
}

/**
 * Mapeamentos que valem para praticamente todo provedor HTTP.
 *
 * Cada adapter prefixa os seus proprios, mais especificos.
 */
export const COMMON_ERROR_MAPPINGS: readonly ErrorMapping[] = Object.freeze([
  { when: { status: 401 }, to: BaasErrorCode.PROVIDER_CREDENTIALS_INVALID },
  { when: { status: 403 }, to: BaasErrorCode.AUTHORIZATION_DENIED },
  { when: { status: 404 }, to: BaasErrorCode.RESOURCE_NOT_FOUND },
  { when: { status: 409 }, to: BaasErrorCode.RESOURCE_ALREADY_EXISTS },
  {
    when: { status: 429 },
    to: BaasErrorCode.PROVIDER_RATE_LIMITED,
    retryable: true,
    safeToRetry: true,
  },
  {
    when: { status: [502, 503, 504] },
    to: BaasErrorCode.PROVIDER_UNAVAILABLE,
    retryable: true,
    safeToRetry: true,
  },
  {
    when: { status: (s) => s >= 500 },
    to: BaasErrorCode.PROVIDER_UNAVAILABLE,
    retryable: true,
    safeToRetry: false,
  },
]);
