import type { Token, TokenStore } from '@baasconn/provider-spi';

export interface PreparedRequest {
  method: string;
  /** Caminho e query, como serao enviados. */
  path: string;
  headers: Record<string, string>;
  /** Corpo ja serializado, para assinatura HMAC. */
  body?: string;
  timestamp: number;
}

export interface AuthStrategy {
  readonly kind: 'oauth2_cc' | 'api_key' | 'hmac' | 'mtls' | 'composite' | 'none';
  apply(request: PreparedRequest): Promise<void>;
  /** Chamada em 401/403. Retorna true para o chamador tentar mais uma vez. */
  onUnauthorized?(): Promise<boolean>;
  /** Materiais de TLS mutuo, quando a estrategia os fornece. */
  tlsMaterials?(): { cert: string; key: string; ca?: string; passphrase?: string } | undefined;
}

export class NoAuthStrategy implements AuthStrategy {
  readonly kind = 'none' as const;
  async apply(): Promise<void> {}
}

/**
 * Chave de API estatica em header.
 *
 * Cobre Asaas (`access_token`) e Woovi (`Authorization: <AppID>`), que nao
 * usam o esquema Bearer.
 */
export class StaticApiKeyStrategy implements AuthStrategy {
  readonly kind = 'api_key' as const;

  constructor(private readonly config: { header: string; value: string; prefix?: string }) {}

  async apply(request: PreparedRequest): Promise<void> {
    const { header, value, prefix } = this.config;
    request.headers[header] = prefix ? `${prefix} ${value}` : value;
  }
}

export interface OAuth2Config {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  /** RFC 6749 permite Basic ou corpo form-encoded. Celcoin usa corpo. */
  credentialPlacement: 'basic' | 'body';
  /** Como injetar o token. Padrao: `Authorization: Bearer`. */
  applyToken?: (token: string) => Record<string, string>;
  /** Renova este tanto de segundos antes do vencimento. */
  skewSeconds?: number;
  tokenStore: TokenStore;
  cacheKey: string;
  fetchToken: () => Promise<Token>;
}

/**
 * OAuth2 client_credentials com cache e single-flight.
 *
 * O cache fica no `TokenStore` injetado, que na producao e Redis com lock: sem
 * coalescencia, 200 requisicoes concorrentes num token expirado viram 200
 * chamadas ao endpoint de token, e a conexao toma rate limit no pior momento.
 */
export class OAuth2ClientCredentialsStrategy implements AuthStrategy {
  readonly kind = 'oauth2_cc' as const;

  constructor(private readonly config: OAuth2Config) {}

  async apply(request: PreparedRequest): Promise<void> {
    const token = await this.config.tokenStore.getOrFetch(
      this.config.cacheKey,
      this.config.fetchToken,
    );
    const headers = this.config.applyToken
      ? this.config.applyToken(token.accessToken)
      : { Authorization: `Bearer ${token.accessToken}` };
    Object.assign(request.headers, headers);
  }

  /** Um 401 pode ser token revogado antes do vencimento. Invalida e tenta uma vez. */
  async onUnauthorized(): Promise<boolean> {
    await this.config.tokenStore.invalidate(this.config.cacheKey);
    return true;
  }
}

export interface HmacConfig {
  algorithm: 'sha256' | 'sha512';
  secret: string;
  /** String canonica a assinar. Cada provedor define a sua. */
  canonicalString: (request: PreparedRequest) => string;
  /** Headers a anexar, a partir da assinatura e do timestamp. */
  headers: (signature: string, timestamp: number) => Record<string, string>;
  encoding?: 'hex' | 'base64';
}

export class HmacSignatureStrategy implements AuthStrategy {
  readonly kind = 'hmac' as const;

  constructor(private readonly config: HmacConfig) {}

  async apply(request: PreparedRequest): Promise<void> {
    const { createHmac } = await import('node:crypto');
    const signature = createHmac(this.config.algorithm, this.config.secret)
      .update(this.config.canonicalString(request))
      .digest(this.config.encoding ?? 'hex');
    Object.assign(request.headers, this.config.headers(signature, request.timestamp));
  }
}

export interface MtlsConfig {
  cert: string;
  key: string;
  ca?: string;
  passphrase?: string;
}

/** TLS mutuo, exigido em fluxos que falam direto com o SPI. */
export class MtlsStrategy implements AuthStrategy {
  readonly kind = 'mtls' as const;

  constructor(private readonly config: MtlsConfig) {}

  async apply(): Promise<void> {}

  tlsMaterials(): MtlsConfig {
    return this.config;
  }
}

/** Combina estrategias: por exemplo OAuth2 sobre mTLS. */
export class CompositeStrategy implements AuthStrategy {
  readonly kind = 'composite' as const;

  constructor(private readonly strategies: readonly AuthStrategy[]) {}

  async apply(request: PreparedRequest): Promise<void> {
    for (const strategy of this.strategies) await strategy.apply(request);
  }

  async onUnauthorized(): Promise<boolean> {
    let retry = false;
    for (const strategy of this.strategies) {
      if (await strategy.onUnauthorized?.()) retry = true;
    }
    return retry;
  }

  tlsMaterials(): MtlsConfig | undefined {
    for (const strategy of this.strategies) {
      const materials = strategy.tlsMaterials?.();
      if (materials) return materials;
    }
    return undefined;
  }
}
