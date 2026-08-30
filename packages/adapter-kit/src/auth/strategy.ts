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

export interface AsymmetricJwtConfig {
  /**
   * Algoritmo de assinatura JWS.
   *
   * `ES512` e ECDSA com SHA-512, que e o que a QI Tech usa. Repare que
   * ECDSA e ASSIMETRICO: assinamos com a chave privada e o provedor verifica
   * com a nossa publica. Isso e categoricamente diferente de HMAC, onde os
   * dois lados compartilham o mesmo segredo — e por isso `HmacSignatureStrategy`
   * NAO serve aqui, apesar de a tabela do guia ter dito por um tempo que servia.
   */
  algorithm: 'ES256' | 'ES512' | 'RS256' | 'RS512';
  /** Chave privada em PEM (PKCS#8). */
  privateKey: string;
  /** Vai no header `kid` do JWS, para o provedor achar a chave publica. */
  keyId?: string;
  /**
   * Monta o payload assinado a partir da requisicao.
   *
   * Cada provedor define o seu. A QI Tech assina o corpo inteiro mais o
   * metodo e o caminho, para a assinatura cobrir a requisicao toda e nao so
   * uma parte dela.
   */
  claims: (request: PreparedRequest) => Record<string, unknown>;
  /** Onde o JWS entra. Padrao: `Authorization: <jws>` e o corpo substituido. */
  headers: (jws: string, request: PreparedRequest) => Record<string, string>;
  /** Quando presente, o corpo enviado passa a ser o proprio JWS. */
  replaceBody?: boolean;
  /** Tolerancia de relogio embutida no `iat`. */
  clockSkewSeconds?: number;
}

/**
 * Assinatura ASSIMETRICA por requisicao, no formato JWS compacto.
 *
 * Existe porque o kit so cobria HMAC, que e simetrico, e provedores como a QI
 * Tech assinam com par de chaves — a requisicao E a resposta. Tratar isso como
 * HMAC nao e uma aproximacao ruim, e impossivel: nao existe segredo
 * compartilhado para o `createHmac` usar.
 *
 * A verificacao da RESPOSTA e metade do contrato nesses provedores, e fica em
 * `verifyResponse`. Aceitar resposta nao verificada anularia o motivo de a
 * assinatura existir: sem ela, um intermediario pode reescrever o corpo de uma
 * confirmacao de pagamento e nos acreditariamos.
 */
export class AsymmetricJwtStrategy implements AuthStrategy {
  readonly kind = 'hmac' as const;

  constructor(private readonly config: AsymmetricJwtConfig) {}

  async apply(request: PreparedRequest): Promise<void> {
    const jws = await this.sign(request);
    Object.assign(request.headers, this.config.headers(jws, request));
    if (this.config.replaceBody) request.body = jws;
  }

  private async sign(request: PreparedRequest): Promise<string> {
    const { createSign, createPrivateKey } = await import('node:crypto');

    const header = base64url(
      JSON.stringify({
        alg: this.config.algorithm,
        typ: 'JWT',
        ...(this.config.keyId ? { kid: this.config.keyId } : {}),
      }),
    );
    const payload = base64url(
      JSON.stringify({
        iat: Math.floor(request.timestamp / 1000) - (this.config.clockSkewSeconds ?? 0),
        ...this.config.claims(request),
      }),
    );

    const signing = `${header}.${payload}`;
    const signer = createSign(HASH_FOR[this.config.algorithm]);
    signer.update(signing);
    signer.end();

    // `dsaEncoding: 'ieee-p1363'` NAO e detalhe: o padrao do Node para ECDSA e
    // DER, e o JWS exige a forma crua R||S. Assinar em DER produz um token que
    // toda biblioteca de JWT recusa, com erro que nao diz por que.
    const signature = signer.sign(
      { key: createPrivateKey(this.config.privateKey), dsaEncoding: 'ieee-p1363' },
      'base64',
    );

    return `${signing}.${toBase64Url(signature)}`;
  }

  /**
   * Verifica a assinatura de uma resposta do provedor.
   *
   * Devolve o payload quando confere e LANCA quando nao — nunca devolve
   * `false` silenciosamente, porque um chamador que ignora o booleano e
   * indistinguivel de um que nao verificou.
   */
  static async verifyResponse(
    jws: string,
    publicKeyPem: string,
    algorithm: AsymmetricJwtConfig['algorithm'],
  ): Promise<Record<string, unknown>> {
    const { createVerify, createPublicKey } = await import('node:crypto');
    const parts = jws.split('.');
    if (parts.length !== 3) {
      throw new Error('Resposta assinada malformada: nao tem tres segmentos.');
    }

    const verifier = createVerify(HASH_FOR[algorithm]);
    verifier.update(`${parts[0]}.${parts[1]}`);
    verifier.end();

    const ok = verifier.verify(
      { key: createPublicKey(publicKeyPem), dsaEncoding: 'ieee-p1363' },
      fromBase64Url(parts[2]!),
    );
    if (!ok) throw new Error('Assinatura da resposta do provedor nao confere.');

    return JSON.parse(Buffer.from(fromBase64Url(parts[1]!)).toString('utf8')) as Record<
      string,
      unknown
    >;
  }
}

const HASH_FOR: Readonly<Record<AsymmetricJwtConfig['algorithm'], string>> = Object.freeze({
  ES256: 'sha256',
  ES512: 'sha512',
  RS256: 'sha256',
  RS512: 'sha512',
});

function base64url(value: string): string {
  return toBase64Url(Buffer.from(value, 'utf8').toString('base64'));
}

function toBase64Url(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
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
