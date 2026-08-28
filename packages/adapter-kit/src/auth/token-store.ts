import type { Token, TokenStore } from '@baasconn/provider-spi';
import type { Clock } from '@baasconn/taxonomy';

interface CachedToken {
  token: Token;
  expiresAtMs: number;
}

/**
 * TokenStore em memoria com coalescencia de promessa.
 *
 * Suficiente para single-process e testes. A implementacao de producao usa
 * Redis com lock distribuido, para pods diferentes tambem coalescerem.
 */
export class InMemoryTokenStore implements TokenStore {
  private readonly cache = new Map<string, CachedToken>();
  private readonly inFlight = new Map<string, Promise<Token>>();

  constructor(
    private readonly clock: Clock,
    private readonly skewSeconds = 60,
  ) {}

  async getOrFetch(key: string, fetch: () => Promise<Token>): Promise<Token> {
    const now = this.clock.now().getTime();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAtMs > now) return cached.token;

    // Coalescencia: N chamadas concorrentes viram uma so ida ao provedor.
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const promise = fetch()
      .then((token) => {
        const ttlSeconds = Math.max(30, token.expiresInSeconds - this.skewSeconds);
        this.cache.set(key, { token, expiresAtMs: now + ttlSeconds * 1000 });
        return token;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, promise);
    return promise;
  }

  async invalidate(key: string): Promise<void> {
    this.cache.delete(key);
  }

  size(): number {
    return this.cache.size;
  }
}
