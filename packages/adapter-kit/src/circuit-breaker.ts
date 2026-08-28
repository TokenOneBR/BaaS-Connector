import type { CircuitBreaker, CircuitState } from '@baasconn/provider-spi';
import { BaasError, BaasErrorCode, type Clock } from '@baasconn/taxonomy';

export interface BreakerPolicy {
  /** Requisicoes minimas na janela antes de considerar abrir. */
  minimumRequests: number;
  /** Fracao de falha que abre o circuito, entre 0 e 1. */
  failureRatio: number;
  windowMs: number;
  openMs: number;
  /** Sondas permitidas em half-open. */
  halfOpenProbes: number;
}

export const DEFAULT_BREAKER_POLICY: BreakerPolicy = Object.freeze({
  minimumRequests: 20,
  failureRatio: 0.5,
  windowMs: 60_000,
  openMs: 30_000,
  halfOpenProbes: 3,
});

interface BreakerBucket {
  successes: number;
  failures: number;
  windowStart: number;
  openedAt?: number;
  probesInFlight: number;
}

/**
 * Circuit breaker em memoria.
 *
 * A implementacao de producao guarda estado no Redis, para todos os pods
 * concordarem. Esta serve para teste e para o modo single-process.
 *
 * Erros 4xx NAO abrem o circuito: um CPF invalido repetido nao e falha do
 * provedor, e abrir por isso tiraria de servico uma conexao saudavel.
 */
export class InMemoryCircuitBreaker implements CircuitBreaker {
  private readonly buckets = new Map<string, BreakerBucket>();

  constructor(
    private readonly clock: Clock,
    private readonly policy: BreakerPolicy = DEFAULT_BREAKER_POLICY,
  ) {}

  private bucket(key: string): BreakerBucket {
    const now = this.clock.now().getTime();
    const existing = this.buckets.get(key);
    if (!existing || now - existing.windowStart > this.policy.windowMs) {
      const fresh: BreakerBucket = {
        successes: 0,
        failures: 0,
        windowStart: now,
        openedAt: existing?.openedAt,
        probesInFlight: 0,
      };
      this.buckets.set(key, fresh);
      return fresh;
    }
    return existing;
  }

  async state(key: string): Promise<CircuitState> {
    const bucket = this.bucket(key);
    if (bucket.openedAt === undefined) return 'CLOSED';
    const elapsed = this.clock.now().getTime() - bucket.openedAt;
    return elapsed >= this.policy.openMs ? 'HALF_OPEN' : 'OPEN';
  }

  async assertClosed(key: string): Promise<void> {
    const state = await this.state(key);
    if (state === 'CLOSED') return;

    const bucket = this.bucket(key);
    if (state === 'HALF_OPEN' && bucket.probesInFlight < this.policy.halfOpenProbes) {
      bucket.probesInFlight += 1;
      return;
    }

    const retryAfter = Math.ceil(
      (this.policy.openMs - (this.clock.now().getTime() - (bucket.openedAt ?? 0))) / 1000,
    );
    throw new BaasError(BaasErrorCode.PROVIDER_CIRCUIT_OPEN, {
      message: `Circuito aberto para ${key}; chamadas suspensas temporariamente`,
      retryAfterSeconds: Math.max(retryAfter, 1),
      meta: { breakerKey: key },
    });
  }

  async recordSuccess(key: string): Promise<void> {
    const bucket = this.bucket(key);
    bucket.successes += 1;
    bucket.probesInFlight = Math.max(0, bucket.probesInFlight - 1);
    // Sonda bem-sucedida em half-open fecha o circuito.
    if (bucket.openedAt !== undefined) {
      const elapsed = this.clock.now().getTime() - bucket.openedAt;
      if (elapsed >= this.policy.openMs) {
        bucket.openedAt = undefined;
        bucket.failures = 0;
        bucket.successes = 0;
        bucket.windowStart = this.clock.now().getTime();
      }
    }
  }

  async recordFailure(key: string): Promise<void> {
    const bucket = this.bucket(key);
    bucket.failures += 1;
    bucket.probesInFlight = Math.max(0, bucket.probesInFlight - 1);

    const total = bucket.successes + bucket.failures;
    if (total < this.policy.minimumRequests) return;
    if (bucket.failures / total >= this.policy.failureRatio) {
      bucket.openedAt = this.clock.now().getTime();
    }
  }

  reset(): void {
    this.buckets.clear();
  }
}

/** Chave do breaker: provedor x ambiente x classe de endpoint. */
export function breakerKey(provider: string, environment: string, endpointClass: string): string {
  return `${provider}:${environment}:${endpointClass}`;
}
