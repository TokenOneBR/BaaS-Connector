import type { EnvelopeCrypto, WebhookEndpointRecord } from '@baasconn/api/domain';
import type { Clock } from '@baasconn/taxonomy';

interface Cached {
  secrets: string[];
  /** `updatedAt` do endpoint: rotacionar invalida por construcao. */
  version: number;
  expiresAtMs: number;
}

/** Curto de proposito: um segredo rotacionado nao pode valer por muito tempo. */
const TTL_MS = 60_000;

/**
 * Segredos do endpoint, decifrados e cacheados.
 *
 * Sem cache, cada entrega paga um unwrap de KMS. A 500 eventos/s isso e conta
 * de KMS e piso de latencia — e a chamada e identica para o mesmo endpoint.
 *
 * A chave do cache inclui `updatedAt`, entao rotacionar o segredo invalida o
 * cache sem ninguem precisar lembrar de limpar.
 */
export class EndpointSecrets {
  private readonly cache = new Map<string, Cached>();

  constructor(
    private readonly crypto: EnvelopeCrypto,
    private readonly clock: Clock,
  ) {}

  async for(endpoint: WebhookEndpointRecord): Promise<string[]> {
    const now = this.clock.now().getTime();
    const version = endpoint.updatedAt.getTime();
    const cached = this.cache.get(endpoint.id);

    if (cached && cached.version === version && cached.expiresAtMs > now) {
      return cached.secrets;
    }

    const secrets = [await this.crypto.decryptToString(endpoint.secret)];

    // O segredo anterior so entra DENTRO da janela. Passado o prazo, mante-lo
    // pagaria um unwrap de KMS por entrega para assinar com uma chave que o
    // cliente ja deveria ter descartado.
    const janelaAberta =
      endpoint.previousSecret != null &&
      endpoint.previousSecretExpiresAt != null &&
      endpoint.previousSecretExpiresAt.getTime() > now;

    if (janelaAberta && endpoint.previousSecret) {
      secrets.push(await this.crypto.decryptToString(endpoint.previousSecret));
    }

    this.cache.set(endpoint.id, { secrets, version, expiresAtMs: now + TTL_MS });
    return secrets;
  }
}
