import { generateKeyPairSync } from 'node:crypto';

import { BaasErrorCode, FixedClock, ProviderOutcomeUnknownError } from '@baasconn/taxonomy';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  AsymmetricJwtStrategy,
  NoAuthStrategy,
  StaticApiKeyStrategy,
  InMemoryTokenStore,
  OAuth2ClientCredentialsStrategy,
  type PreparedRequest,
} from './auth/index.js';
import { breakerKey, InMemoryCircuitBreaker } from './circuit-breaker.js';
import { buildErrorMapper, COMMON_ERROR_MAPPINGS, extractProviderCode } from './errors/mapper.js';
import { HttpClient } from './http/client.js';
import { BASE_REDACTION, extendRedaction, maskValue, redact, redactHeaders } from './redaction.js';
import {
  computeDelayMs,
  DEFAULT_RETRY_POLICY,
  DEFAULT_SHOULD_RETRY,
  isProvablyPreCommit,
  parseRetryAfter,
} from './retry.js';
import { canonicalBodyHash, CassetteServer, type Cassette } from './testing/cassette-server.js';

const clock = () => new FixedClock(new Date('2026-08-28T12:00:00Z'));

describe('redacao', () => {
  it('mascara CPF preservando os ultimos digitos, que o suporte usa', () => {
    expect(maskValue('529.982.247-25')).toBe('***.***.247-25');
  });

  it('mascara email preservando o dominio', () => {
    expect(maskValue('lnugnes@tokenone.com.br')).toBe('l******@tokenone.com.br');
  });

  it('redige documento em qualquer profundidade do payload', () => {
    const result = redact({
      payer: { name: 'Maria', cpf: '52998224725' },
      nested: { deep: { taxId: '11222333000181' } },
    }) as Record<string, any>;

    expect(result.payer.cpf).not.toContain('52998');
    expect(result.nested.deep.taxId).not.toContain('11222333');
    expect(result.payer.name).toBe('Maria');
  });

  it('remove blob de documento em vez de mascarar', () => {
    const result = redact({ fileContent: 'AAAA'.repeat(1000), kind: 'RG' }) as Record<
      string,
      unknown
    >;
    expect(result).not.toHaveProperty('fileContent');
    expect(result.kind).toBe('RG');
  });

  it('hasheia chave Pix: correlaciona sem expor', () => {
    const result = redact({ pixKey: 'joao@exemplo.com' }) as Record<string, string>;
    expect(result.pixKey).toMatch(/^sha256:[0-9a-f]{16}$/);
  });

  it('hash e estavel: a mesma chave correlaciona entre duas chamadas', () => {
    const first = redact({ pixKey: 'joao@exemplo.com' }) as Record<string, string>;
    const second = redact({ pixKey: 'joao@exemplo.com' }) as Record<string, string>;
    expect(first.pixKey).toBe(second.pixKey);
  });

  it('trunca corpo grande guardando o digest', () => {
    const result = redact({ items: Array.from({ length: 5000 }, (_, i) => ({ i })) }) as Record<
      string,
      unknown
    >;
    expect(result._truncated).toBe(true);
    expect(result._digest).toMatch(/^sha256:/);
  });

  it('mascara headers de credencial e preserva os demais', () => {
    const headers = redactHeaders({
      authorization: 'Bearer secreto',
      access_token: 'chave-do-asaas',
      'content-type': 'application/json',
    });
    expect(headers.authorization).toBe('[REDACTED]');
    expect(headers.access_token).toBe('[REDACTED]');
    expect(headers['content-type']).toBe('application/json');
  });

  it('extendRedaction compoe sem perder as regras base', () => {
    const rules = extendRedaction(BASE_REDACTION, { maskPaths: ['*.numeroConta'] });
    const result = redact({ numeroConta: '12345678', cpf: '52998224725' }, rules) as Record<
      string,
      string
    >;
    expect(result.numeroConta).not.toBe('12345678');
    expect(result.cpf).not.toContain('52998');
  });
});

describe('politica de retry', () => {
  it('retenta rede, 429 e 5xx; nao retenta 4xx de negocio', () => {
    expect(DEFAULT_SHOULD_RETRY({ kind: 'network' })).toBe(true);
    expect(DEFAULT_SHOULD_RETRY({ kind: 'http', status: 429 })).toBe(true);
    expect(DEFAULT_SHOULD_RETRY({ kind: 'http', status: 503 })).toBe(true);
    expect(DEFAULT_SHOULD_RETRY({ kind: 'http', status: 422 })).toBe(false);
  });

  it('nao retenta timeout de body nem em requisicao idempotente', () => {
    // Se o corpo comecou a ser enviado e o servidor parou de responder, ele
    // pode ter processado.
    expect(DEFAULT_SHOULD_RETRY({ kind: 'timeout', phase: 'body' })).toBe(false);
    expect(DEFAULT_SHOULD_RETRY({ kind: 'timeout', phase: 'connect' })).toBe(true);
  });

  describe('isProvablyPreCommit', () => {
    it('aceita apenas falhas anteriores a qualquer processamento', () => {
      expect(isProvablyPreCommit({ kind: 'timeout', phase: 'connect' })).toBe(true);
      expect(isProvablyPreCommit({ kind: 'network', code: 'ECONNREFUSED' })).toBe(true);
      expect(isProvablyPreCommit({ kind: 'network', code: 'ENOTFOUND' })).toBe(true);
      expect(isProvablyPreCommit({ kind: 'http', status: 429 })).toBe(true);
    });

    it('recusa timeout de headers e body: o desfecho e indeterminado', () => {
      expect(isProvablyPreCommit({ kind: 'timeout', phase: 'headers' })).toBe(false);
      expect(isProvablyPreCommit({ kind: 'timeout', phase: 'body' })).toBe(false);
      expect(isProvablyPreCommit({ kind: 'network', code: 'ECONNRESET' })).toBe(false);
      expect(isProvablyPreCommit({ kind: 'http', status: 500 })).toBe(false);
    });
  });

  it('honra Retry-After respeitando o teto', () => {
    const delay = computeDelayMs(0, DEFAULT_RETRY_POLICY, {
      kind: 'http',
      status: 429,
      retryAfterSeconds: 3600,
    });
    expect(delay).toBe(DEFAULT_RETRY_POLICY.maxRetryAfterSeconds * 1000);
  });

  it('usa full jitter: o atraso varia entre zero e o teto', () => {
    const zero = computeDelayMs(2, DEFAULT_RETRY_POLICY, { kind: 'network' }, () => 0);
    const max = computeDelayMs(2, DEFAULT_RETRY_POLICY, { kind: 'network' }, () => 0.999);
    expect(zero).toBe(0);
    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThanOrEqual(DEFAULT_RETRY_POLICY.maxDelayMs);
  });

  it('parseia Retry-After em segundos e em data HTTP', () => {
    expect(parseRetryAfter('30')).toBe(30);
    expect(parseRetryAfter(undefined)).toBeUndefined();
    expect(parseRetryAfter('nao-e-data')).toBeUndefined();
  });
});

describe('circuit breaker', () => {
  it('abre apos a fracao de falha ser atingida na janela', async () => {
    const c = clock();
    const breaker = new InMemoryCircuitBreaker(c);
    const key = breakerKey('CELCOIN', 'HOMOLOGACAO', 'write');

    for (let i = 0; i < 20; i++) await breaker.recordFailure(key);
    expect(await breaker.state(key)).toBe('OPEN');
    await expect(breaker.assertClosed(key)).rejects.toThrow(/Circuito aberto/);
  });

  it('nao abre com poucas requisicoes, mesmo todas falhando', async () => {
    const breaker = new InMemoryCircuitBreaker(clock());
    const key = breakerKey('CELCOIN', 'HOMOLOGACAO', 'write');
    for (let i = 0; i < 5; i++) await breaker.recordFailure(key);
    expect(await breaker.state(key)).toBe('CLOSED');
  });

  it('passa a half-open depois da janela e fecha com sonda bem-sucedida', async () => {
    const c = clock();
    const breaker = new InMemoryCircuitBreaker(c);
    const key = breakerKey('CELCOIN', 'HOMOLOGACAO', 'write');
    for (let i = 0; i < 20; i++) await breaker.recordFailure(key);

    c.advanceSeconds(31);
    expect(await breaker.state(key)).toBe('HALF_OPEN');
    await expect(breaker.assertClosed(key)).resolves.toBeUndefined();

    await breaker.recordSuccess(key);
    expect(await breaker.state(key)).toBe('CLOSED');
  });

  it('erro do cliente nao abre o circuito', async () => {
    // Um CPF invalido repetido nao e falha do provedor; abrir por isso tiraria
    // de servico uma conexao saudavel.
    const breaker = new InMemoryCircuitBreaker(clock());
    const key = breakerKey('CELCOIN', 'HOMOLOGACAO', 'write');
    for (let i = 0; i < 30; i++) await breaker.recordSuccess(key);
    expect(await breaker.state(key)).toBe('CLOSED');
  });
});

describe('mapeamento de erro', () => {
  const mapper = buildErrorMapper([
    { when: { status: 400, code: /^CBE0?09/ }, to: BaasErrorCode.INSUFFICIENT_FUNDS },
    { when: { status: 400, code: 'INVALID_CPF' }, to: BaasErrorCode.INVALID_TAX_ID },
    ...COMMON_ERROR_MAPPINGS,
  ]);

  it('mapeia codigo do provedor para o codigo canonico', () => {
    const error = mapper({
      status: 400,
      body: { error: { code: 'CBE009', message: 'saldo insuficiente' } },
      providerSlug: 'CELCOIN',
    });
    expect(error.code).toBe(BaasErrorCode.INSUFFICIENT_FUNDS);
    expect(error.httpStatus).toBe(422);
  });

  it('preserva o codigo bruto do provedor para escalacao ao suporte', () => {
    const error = mapper({
      status: 400,
      body: { error: { code: 'CBE009', message: 'saldo insuficiente' } },
      providerSlug: 'CELCOIN',
    });
    expect(error.provider).toMatchObject({ slug: 'CELCOIN', code: 'CBE009' });
  });

  it('cai no fallback quando o codigo e desconhecido', () => {
    const error = mapper({
      status: 400,
      body: { error: { code: 'NOVO_CODIGO' } },
      providerSlug: 'CELCOIN',
    });
    expect(error.code).toBe(BaasErrorCode.PROVIDER_REJECTED);
  });

  it('marca 429 e 503 como seguros para retentar', () => {
    expect(mapper({ status: 429, body: {}, providerSlug: 'X' }).safeToRetry).toBe(true);
    expect(mapper({ status: 503, body: {}, providerSlug: 'X' }).safeToRetry).toBe(true);
  });

  it('marca 500 generico como retentavel mas NAO seguro para escrita', () => {
    const error = mapper({ status: 500, body: {}, providerSlug: 'X' });
    expect(error.retryable).toBe(true);
    expect(error.safeToRetry).toBe(false);
  });

  it('encontra o codigo em caminhos diferentes de payload', () => {
    expect(extractProviderCode({ error: { code: 'A' } })).toBe('A');
    expect(extractProviderCode({ errorCode: 'B' })).toBe('B');
    expect(extractProviderCode({ errors: [{ code: 'C' }] })).toBe('C');
    expect(extractProviderCode({ nada: 1 })).toBeUndefined();
  });
});

describe('CassetteServer', () => {
  let server: CassetteServer;

  const cassette: Cassette = {
    provider: 'stub',
    scenario: 'basico',
    source: 'handcrafted-from-docs',
    interactions: [
      {
        request: { method: 'GET', path: '/v1/balance' },
        response: { status: 200, body: { available: 15000 } },
      },
      {
        request: { method: 'POST', path: '/v1/pix', bodyHash: canonicalBodyHash({ amount: 100 }) },
        response: { status: 201, body: { id: 'tx_1' } },
      },
      {
        request: { method: 'GET', path: '/v1/lento' },
        response: { status: 200, body: {}, delayMs: 200 },
      },
      {
        request: { method: 'GET', path: '/v1/uma-vez' },
        response: { status: 200, body: { n: 1 } },
        maxUses: 1,
      },
    ],
  };

  beforeEach(async () => {
    server = new CassetteServer({ cassettes: [cassette] });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it('serve a resposta gravada por metodo e caminho', async () => {
    const response = await fetch(`${server.baseUrl}/v1/balance`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ available: 15000 });
  });

  it('casa por hash do corpo, tolerando ordem de chave diferente', async () => {
    const response = await fetch(`${server.baseUrl}/v1/pix`, {
      method: 'POST',
      body: JSON.stringify({ amount: 100 }),
    });
    expect(response.status).toBe(201);
  });

  it('nao casa quando o corpo diverge', async () => {
    const response = await fetch(`${server.baseUrl}/v1/pix`, {
      method: 'POST',
      body: JSON.stringify({ amount: 999 }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'cassette_no_match' });
  });

  it('respeita maxUses, para testar esgotamento', async () => {
    expect((await fetch(`${server.baseUrl}/v1/uma-vez`)).status).toBe(200);
    expect((await fetch(`${server.baseUrl}/v1/uma-vez`)).status).toBe(404);
  });

  it('registra o que o adapter enviou, para o teste afirmar sobre isso', async () => {
    await fetch(`${server.baseUrl}/v1/balance`, { headers: { 'x-teste': 'sim' } });
    expect(server.received).toHaveLength(1);
    expect(server.received[0]).toMatchObject({ method: 'GET', path: '/v1/balance', matched: true });
    expect(server.received[0]?.headers['x-teste']).toBe('sim');
  });
});

describe('HttpClient', () => {
  let server: CassetteServer;
  const cassettes: Cassette[] = [
    {
      provider: 'stub',
      scenario: 'http-client',
      source: 'handcrafted-from-docs',
      interactions: [
        { request: { method: 'GET', path: '/ok' }, response: { status: 200, body: { ok: true } } },
        {
          request: { method: 'GET', path: '/erro' },
          response: { status: 400, body: { error: { code: 'X1', message: 'ruim' } } },
        },
        {
          request: { method: 'POST', path: '/lento' },
          response: { status: 200, body: {}, delayMs: 3_000 },
        },
        {
          request: { method: 'GET', path: '/lento-get' },
          response: { status: 200, body: {}, delayMs: 3_000 },
        },
      ],
    },
  ];

  beforeEach(async () => {
    server = new CassetteServer({ cassettes });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  const build = (overrides: Partial<ConstructorParameters<typeof HttpClient>[0]> = {}) =>
    new HttpClient({
      baseUrl: server.baseUrl,
      providerSlug: 'STUB',
      environment: 'HOMOLOGACAO',
      connectionId: 'con_1',
      auth: new NoAuthStrategy(),
      errorMapper: buildErrorMapper(COMMON_ERROR_MAPPINGS),
      clock: { now: () => new Date() },
      ...overrides,
    });

  it('faz uma chamada bem-sucedida e reporta metadados', async () => {
    const client = build();
    const response = await client.request<{ ok: boolean }>({
      method: 'GET',
      path: '/ok',
      endpointClass: 'read',
    });
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.meta.attempts).toBe(1);
  });

  it('mapeia erro do provedor para BaasError', async () => {
    const client = build();
    await expect(
      client.request({ method: 'GET', path: '/erro', endpointClass: 'read' }),
    ).rejects.toMatchObject({ code: BaasErrorCode.PROVIDER_REJECTED });
  });

  it('emite registro de chamada ja redigido', async () => {
    const records: unknown[] = [];
    const client = build({ onCall: (r) => records.push(r) });
    await client.request({
      method: 'GET',
      path: '/ok',
      endpointClass: 'read',
      headers: { authorization: 'Bearer super-secreto' },
    });

    expect(records).toHaveLength(1);
    expect(JSON.stringify(records)).not.toContain('super-secreto');
  });

  /**
   * A regra mais importante do kit. Sem ela, um timeout num PIX out vira
   * retry cego e o cliente paga duas vezes.
   */
  it('converte timeout em escrita nao idempotente em ProviderOutcomeUnknownError', async () => {
    const client = build({
      operationId: 'opr_01',
      timeouts: { write: { connectMs: 3_000, headersMs: 200, bodyMs: 200, totalMs: 400 } },
      retry: { ...DEFAULT_RETRY_POLICY, maxAttempts: 1 },
    });

    await expect(
      client.request({ method: 'POST', path: '/lento', endpointClass: 'write' }),
    ).rejects.toBeInstanceOf(ProviderOutcomeUnknownError);
  });

  it('nao envia a requisicao de novo quando o desfecho e desconhecido', async () => {
    const client = build({
      operationId: 'opr_01',
      timeouts: { write: { connectMs: 3_000, headersMs: 200, bodyMs: 200, totalMs: 400 } },
    });

    await expect(
      client.request({ method: 'POST', path: '/lento', endpointClass: 'write' }),
    ).rejects.toBeInstanceOf(ProviderOutcomeUnknownError);

    // Exatamente uma tentativa: retentar seria pagar duas vezes.
    expect(server.received.filter((c) => c.path === '/lento')).toHaveLength(1);
  });

  it('timeout em GET vira PROVIDER_TIMEOUT, nao desfecho desconhecido', async () => {
    const client = build({
      timeouts: { read: { connectMs: 3_000, headersMs: 200, bodyMs: 200, totalMs: 400 } },
      retry: { ...DEFAULT_RETRY_POLICY, maxAttempts: 1 },
    });

    await expect(
      client.request({ method: 'GET', path: '/lento-get', endpointClass: 'read' }),
    ).rejects.toMatchObject({ code: BaasErrorCode.PROVIDER_TIMEOUT });
  });

  it('aplica a estrategia de autenticacao na requisicao', async () => {
    const client = build({
      auth: new StaticApiKeyStrategy({ header: 'access_token', value: 'chave-asaas' }),
    });
    await client.request({ method: 'GET', path: '/ok', endpointClass: 'read' });
    expect(server.received[0]?.headers.access_token).toBe('chave-asaas');
  });
});

describe('cache de token OAuth2', () => {
  it('coalesce chamadas concorrentes numa unica ida ao provedor', async () => {
    const store = new InMemoryTokenStore(clock());
    let fetches = 0;
    const fetchToken = async () => {
      fetches += 1;
      await new Promise((r) => setTimeout(r, 10));
      return { accessToken: 'tok', expiresInSeconds: 900 };
    };

    await Promise.all(Array.from({ length: 50 }, () => store.getOrFetch('k', fetchToken)));
    expect(fetches).toBe(1);
  });

  it('reusa o token ate a janela de folga', async () => {
    const c = clock();
    const store = new InMemoryTokenStore(c);
    let fetches = 0;
    const fetchToken = async () => {
      fetches += 1;
      return { accessToken: 'tok', expiresInSeconds: 900 };
    };

    await store.getOrFetch('k', fetchToken);
    c.advanceSeconds(800);
    await store.getOrFetch('k', fetchToken);
    expect(fetches).toBe(1);

    // 900 - 60 de folga = renova em 840s.
    c.advanceSeconds(100);
    await store.getOrFetch('k', fetchToken);
    expect(fetches).toBe(2);
  });

  it('invalidar forca busca de token novo, para o caso de revogacao', async () => {
    const store = new InMemoryTokenStore(clock());
    let fetches = 0;
    const fetchToken = async () => {
      fetches += 1;
      return { accessToken: `tok-${fetches}`, expiresInSeconds: 900 };
    };

    await store.getOrFetch('k', fetchToken);
    await store.invalidate('k');
    const token = await store.getOrFetch('k', fetchToken);
    expect(token.accessToken).toBe('tok-2');
  });

  it('estrategia OAuth2 injeta o Bearer', async () => {
    const store = new InMemoryTokenStore(clock());
    const strategy = new OAuth2ClientCredentialsStrategy({
      tokenUrl: 'https://x/token',
      clientId: 'id',
      clientSecret: 'segredo',
      credentialPlacement: 'body',
      tokenStore: store,
      cacheKey: 'k',
      fetchToken: async () => ({ accessToken: 'abc', expiresInSeconds: 900 }),
    });

    const request = { method: 'GET', path: '/x', headers: {}, timestamp: 0 };
    await strategy.apply(request);
    expect(request.headers).toMatchObject({ Authorization: 'Bearer abc' });
  });
});

describe('assinatura assimetrica', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-521',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });

  const request = (): PreparedRequest => ({
    method: 'POST',
    path: '/baas/v2/pix/payment',
    headers: {},
    body: JSON.stringify({ amount: 100 }),
    timestamp: Date.parse('2026-08-30T12:00:00.000Z'),
  });

  const strategy = new AsymmetricJwtStrategy({
    algorithm: 'ES512',
    privateKey,
    keyId: 'chave-de-teste',
    claims: (req) => ({ method: req.method, path: req.path, body: req.body }),
    headers: (jws) => ({ authorization: jws }),
  });

  it('produz um JWS de tres segmentos verificavel pela chave publica', async () => {
    const req = request();
    await strategy.apply(req);

    const jws = req.headers.authorization!;
    expect(jws.split('.')).toHaveLength(3);

    const payload = await AsymmetricJwtStrategy.verifyResponse(jws, publicKey, 'ES512');
    expect(payload).toMatchObject({ method: 'POST', path: '/baas/v2/pix/payment' });
  });

  it('o header carrega alg e kid, para o provedor achar a chave publica', async () => {
    const req = request();
    await strategy.apply(req);

    const [header] = req.headers.authorization!.split('.');
    const decoded = JSON.parse(
      Buffer.from(header!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    ) as Record<string, unknown>;

    expect(decoded).toMatchObject({ alg: 'ES512', typ: 'JWT', kid: 'chave-de-teste' });
  });

  it('corpo adulterado nao verifica', async () => {
    const req = request();
    await strategy.apply(req);

    const [header, , signature] = req.headers.authorization!.split('.');
    const forjado = Buffer.from(JSON.stringify({ method: 'POST', amount: 999_999 }), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // Trocar o payload e manter a assinatura e exatamente o ataque que a
    // assinatura existe para impedir: reescrever o valor de um pagamento.
    await expect(
      AsymmetricJwtStrategy.verifyResponse(`${header}.${forjado}.${signature}`, publicKey, 'ES512'),
    ).rejects.toThrow(/nao confere/);
  });

  it('chave publica de outro par nao verifica', async () => {
    const outro = generateKeyPairSync('ec', {
      namedCurve: 'P-521',
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });

    const req = request();
    await strategy.apply(req);

    await expect(
      AsymmetricJwtStrategy.verifyResponse(req.headers.authorization!, outro.publicKey, 'ES512'),
    ).rejects.toThrow(/nao confere/);
  });

  it('resposta malformada e recusada em vez de decodificada', async () => {
    // Sem os tres segmentos nao ha o que verificar. Tentar decodificar assim
    // mesmo aceitaria um corpo nao assinado como se fosse assinado.
    await expect(
      AsymmetricJwtStrategy.verifyResponse('nao.e-jws', publicKey, 'ES512'),
    ).rejects.toThrow(/malformada/);
  });

  it('substitui o corpo pelo JWS quando o provedor exige', async () => {
    const comCorpo = new AsymmetricJwtStrategy({
      algorithm: 'ES512',
      privateKey,
      claims: (req) => ({ body: req.body }),
      headers: () => ({ 'content-type': 'application/jwt' }),
      replaceBody: true,
    });

    const req = request();
    await comCorpo.apply(req);

    expect(req.headers['content-type']).toBe('application/jwt');
    expect(req.body!.split('.')).toHaveLength(3);
  });
});
