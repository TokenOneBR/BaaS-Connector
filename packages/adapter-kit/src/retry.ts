import { BaasErrorCode } from '@baasconn/taxonomy';

export type AttemptOutcome =
  | { kind: 'http'; status: number; retryAfterSeconds?: number }
  | { kind: 'network'; code?: string }
  | { kind: 'timeout'; phase: 'connect' | 'headers' | 'body' };

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  respectRetryAfter: boolean;
  /** Teto para `Retry-After`: um provedor pode mandar 3600 e travar o worker. */
  maxRetryAfterSeconds: number;
  shouldRetry: (outcome: AttemptOutcome) => boolean;
}

/**
 * Retentavel para requisicao IDEMPOTENTE.
 *
 * Timeout de body nao entra: se o corpo comecou a ser enviado e o servidor
 * parou de responder, ele pode ter processado.
 */
export const DEFAULT_SHOULD_RETRY = (outcome: AttemptOutcome): boolean => {
  switch (outcome.kind) {
    case 'network':
      return true;
    case 'timeout':
      return outcome.phase === 'connect';
    case 'http':
      return outcome.status === 408 || outcome.status === 429 || outcome.status >= 500;
  }
};

export const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 4_000,
  respectRetryAfter: true,
  maxRetryAfterSeconds: 30,
  shouldRetry: DEFAULT_SHOULD_RETRY,
});

/**
 * Falha PROVADAMENTE pre-commit.
 *
 * Esta e a regra mais importante do kit. Uma escrita nao idempotente so pode
 * ser retentada quando temos certeza de que o provedor nao chegou a processar:
 * timeout de connect, falha de DNS, 429 (recusa explicita) ou 5xx de gateway
 * antes de rotear. Qualquer outra coisa e desfecho INDETERMINADO, e retentar
 * cegamente e como se paga duas vezes.
 */
export function isProvablyPreCommit(outcome: AttemptOutcome): boolean {
  switch (outcome.kind) {
    case 'timeout':
      return outcome.phase === 'connect';
    case 'network':
      // ECONNREFUSED e falha de DNS acontecem antes de qualquer byte sair.
      return (
        outcome.code === 'ECONNREFUSED' ||
        outcome.code === 'ENOTFOUND' ||
        outcome.code === 'EAI_AGAIN'
      );
    case 'http':
      return outcome.status === 429 || outcome.status === 503;
  }
}

/**
 * Backoff exponencial com full jitter.
 *
 * Full jitter (aleatorio entre 0 e o teto) e nao "exponencial + ruido":
 * sob falha em massa, o segundo espalha as retentativas e o primeiro
 * sincroniza todo mundo no mesmo instante.
 */
export function computeDelayMs(
  attempt: number,
  policy: RetryPolicy,
  outcome: AttemptOutcome,
  random: () => number = Math.random,
): number {
  if (
    policy.respectRetryAfter &&
    outcome.kind === 'http' &&
    outcome.retryAfterSeconds !== undefined
  ) {
    return Math.min(outcome.retryAfterSeconds, policy.maxRetryAfterSeconds) * 1000;
  }
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt);
  return Math.floor(random() * ceiling);
}

export function parseRetryAfter(header: string | undefined): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

export function outcomeToErrorCode(outcome: AttemptOutcome): BaasErrorCode {
  switch (outcome.kind) {
    case 'timeout':
      return BaasErrorCode.PROVIDER_TIMEOUT;
    case 'network':
      return BaasErrorCode.PROVIDER_UNAVAILABLE;
    case 'http':
      if (outcome.status === 429) return BaasErrorCode.PROVIDER_RATE_LIMITED;
      if (outcome.status === 401 || outcome.status === 403) {
        return BaasErrorCode.PROVIDER_CREDENTIALS_INVALID;
      }
      if (outcome.status >= 500) return BaasErrorCode.PROVIDER_UNAVAILABLE;
      return BaasErrorCode.PROVIDER_REJECTED;
  }
}
