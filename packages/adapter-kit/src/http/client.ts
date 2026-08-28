import type { EndpointClass, ProviderCallRecord } from '@baasconn/provider-spi';
import { BaasError, ProviderOutcomeUnknownError, type Clock } from '@baasconn/taxonomy';
import { Agent, request as undiciRequest, type Dispatcher } from 'undici';

import type { AuthStrategy, PreparedRequest } from '../auth/strategy.js';
import type { ErrorMapper } from '../errors/mapper.js';
import { BASE_REDACTION, redact, redactHeaders, type RedactionRules } from '../redaction.js';
import {
  computeDelayMs,
  DEFAULT_RETRY_POLICY,
  isProvablyPreCommit,
  outcomeToErrorCode,
  parseRetryAfter,
  type AttemptOutcome,
  type RetryPolicy,
} from '../retry.js';

import type { CircuitBreaker } from './breaker-port.js';

export interface Timeouts {
  connectMs: number;
  headersMs: number;
  bodyMs: number;
  totalMs: number;
}

/**
 * Timeouts por classe de endpoint.
 *
 * Upload de documento de KYC passa de 20 MB e precisa de folga; autenticacao
 * precisa ser curta, porque um token lento trava todas as chamadas atras dele.
 */
export const DEFAULT_TIMEOUTS: Readonly<Record<EndpointClass, Timeouts>> = Object.freeze({
  read: { connectMs: 3_000, headersMs: 10_000, bodyMs: 10_000, totalMs: 20_000 },
  write: { connectMs: 3_000, headersMs: 10_000, bodyMs: 10_000, totalMs: 20_000 },
  auth: { connectMs: 3_000, headersMs: 5_000, bodyMs: 5_000, totalMs: 8_000 },
  upload: { connectMs: 5_000, headersMs: 60_000, bodyMs: 120_000, totalMs: 120_000 },
});

export interface HttpClientOptions {
  baseUrl: string;
  providerSlug: string;
  environment: string;
  connectionId: string;
  auth: AuthStrategy;
  errorMapper: ErrorMapper;
  clock: Clock;
  breaker?: CircuitBreaker;
  retry?: RetryPolicy;
  redaction?: RedactionRules;
  timeouts?: Partial<Record<EndpointClass, Timeouts>>;
  defaultHeaders?: Record<string, string>;
  userAgent?: string;
  correlationId?: string;
  operationId?: string;
  /** Deadline da requisicao de entrada. */
  signal?: AbortSignal;
  onCall?: (record: ProviderCallRecord) => void;
  /** Injetavel para teste; padrao e undici. */
  dispatcher?: Dispatcher;
}

export interface HttpRequestInit<B = unknown> {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: B;
  headers?: Record<string, string>;
  endpointClass: EndpointClass;
  /**
   * Sobrescreve a inferencia. So requisicao idempotente e retentada
   * automaticamente.
   */
  idempotent?: boolean;
  /** Chave de idempotencia do provedor, derivada do nosso operationId. */
  idempotencyKey?: string;
  form?: Record<string, string>;
  timeoutMs?: number;
}

export interface HttpResponse<T> {
  status: number;
  headers: Record<string, string>;
  body: T;
  meta: { durationMs: number; attempts: number; providerRequestId?: string };
}

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'PUT', 'DELETE']);

function buildUrl(baseUrl: string, path: string, query?: HttpRequestInit['query']): string {
  const url = new URL(
    path.startsWith('/') ? path.slice(1) : path,
    baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`,
  );
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function toOutcome(error: unknown): AttemptOutcome {
  const code = (error as { code?: string } | undefined)?.code;
  const name = (error as { name?: string } | undefined)?.name;

  if (code === 'UND_ERR_CONNECT_TIMEOUT') return { kind: 'timeout', phase: 'connect' };
  if (code === 'UND_ERR_HEADERS_TIMEOUT') return { kind: 'timeout', phase: 'headers' };
  if (code === 'UND_ERR_BODY_TIMEOUT') return { kind: 'timeout', phase: 'body' };
  if (name === 'AbortError' || code === 'ABORT_ERR') return { kind: 'timeout', phase: 'headers' };
  return { kind: 'network', code };
}

export class HttpClient {
  private readonly agent?: Agent;

  constructor(private readonly options: HttpClientOptions) {
    const tls = options.auth.tlsMaterials?.();
    if (tls) {
      // Criar um contexto TLS por requisicao custa CPU de verdade; o Agent
      // fica ligado ao ciclo de vida do adapter.
      this.agent = new Agent({
        connect: { cert: tls.cert, key: tls.key, ca: tls.ca, passphrase: tls.passphrase },
      });
    }
  }

  async request<T = unknown>(init: HttpRequestInit): Promise<HttpResponse<T>> {
    const policy = this.options.retry ?? DEFAULT_RETRY_POLICY;
    const redaction = this.options.redaction ?? BASE_REDACTION;
    const timeouts =
      this.options.timeouts?.[init.endpointClass] ?? DEFAULT_TIMEOUTS[init.endpointClass];
    const isIdempotent = init.idempotent ?? IDEMPOTENT_METHODS.has(init.method);
    const breakerKey = `${this.options.providerSlug}:${this.options.environment}:${init.endpointClass}`;

    const started = this.options.clock.now().getTime();
    let attempts = 0;
    let lastOutcome: AttemptOutcome | undefined;
    let authRetried = false;

    for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
      attempts += 1;
      await this.options.breaker?.assertClosed(breakerKey);

      const prepared = await this.prepare(init);
      const url = buildUrl(this.options.baseUrl, init.path, init.query);

      try {
        const response = await this.send(url, init, prepared, timeouts);
        const rawBody = await this.readBody(response);
        const durationMs = this.options.clock.now().getTime() - started;

        if (response.statusCode >= 200 && response.statusCode < 300) {
          await this.options.breaker?.recordSuccess(breakerKey);
          this.record(init, prepared, redaction, {
            status: response.statusCode,
            body: rawBody,
            durationMs,
            attempts,
            outcome: 'ok',
          });
          return {
            status: response.statusCode,
            headers: this.flatHeaders(response.headers),
            body: rawBody as T,
            meta: {
              durationMs,
              attempts,
              providerRequestId: this.flatHeaders(response.headers)['x-request-id'],
            },
          };
        }

        // 401 pode ser token revogado antes do vencimento: uma unica retentativa
        // com token novo, e so.
        if ((response.statusCode === 401 || response.statusCode === 403) && !authRetried) {
          if (await this.options.auth.onUnauthorized?.()) {
            authRetried = true;
            attempt -= 1;
            continue;
          }
        }

        const outcome: AttemptOutcome = {
          kind: 'http',
          status: response.statusCode,
          retryAfterSeconds: parseRetryAfter(this.flatHeaders(response.headers)['retry-after']),
        };
        lastOutcome = outcome;

        if (response.statusCode >= 500) await this.options.breaker?.recordFailure(breakerKey);

        const canRetry =
          attempt < policy.maxAttempts - 1 &&
          policy.shouldRetry(outcome) &&
          (isIdempotent || isProvablyPreCommit(outcome));

        if (canRetry) {
          await this.sleep(computeDelayMs(attempt, policy, outcome));
          continue;
        }

        this.record(init, prepared, redaction, {
          status: response.statusCode,
          body: rawBody,
          durationMs,
          attempts,
          outcome: 'provider_error',
        });

        throw this.options.errorMapper({
          status: response.statusCode,
          body: rawBody,
          providerSlug: this.options.providerSlug,
          requestId: this.options.correlationId,
        });
      } catch (error) {
        if (error instanceof BaasError) throw error;

        const outcome = toOutcome(error);
        lastOutcome = outcome;
        await this.options.breaker?.recordFailure(breakerKey);

        const canRetry =
          attempt < policy.maxAttempts - 1 &&
          policy.shouldRetry(outcome) &&
          (isIdempotent || isProvablyPreCommit(outcome));

        if (canRetry) {
          await this.sleep(computeDelayMs(attempt, policy, outcome));
          continue;
        }

        throw this.terminalError(init, prepared, redaction, outcome, started, attempts, error);
      }
    }

    throw this.terminalError(
      init,
      await this.prepare(init),
      redaction,
      lastOutcome ?? { kind: 'network' },
      started,
      attempts,
      undefined,
    );
  }

  /**
   * Converte a ultima falha no erro canonico certo.
   *
   * Aqui vive a regra mais importante do kit: numa escrita NAO idempotente
   * cuja falha nao e provadamente pre-commit, o desfecho e INDETERMINADO.
   * Devolver um erro comum convidaria a camada acima a retentar, e e assim que
   * se paga duas vezes. Devolvemos `ProviderOutcomeUnknownError`, que a
   * aplicacao resolve consultando o provedor pela nossa chave.
   */
  private terminalError(
    init: HttpRequestInit,
    prepared: PreparedRequest,
    redaction: RedactionRules,
    outcome: AttemptOutcome,
    started: number,
    attempts: number,
    cause: unknown,
  ): BaasError {
    const durationMs = this.options.clock.now().getTime() - started;
    const isIdempotent = init.idempotent ?? IDEMPOTENT_METHODS.has(init.method);
    const indeterminate = !isIdempotent && !isProvablyPreCommit(outcome);

    this.record(init, prepared, redaction, {
      durationMs,
      attempts,
      outcome: indeterminate ? 'unknown' : outcome.kind === 'timeout' ? 'timeout' : 'network_error',
    });

    if (indeterminate) {
      return new ProviderOutcomeUnknownError(
        this.options.providerSlug,
        this.options.operationId ?? 'sem-operacao',
        {
          message:
            `A chamada ${init.method} ${init.path} falhou sem resposta conclusiva. ` +
            `Nao sabemos se o provedor processou; sera resolvido por conciliacao.`,
          cause,
        },
      );
    }

    return new BaasError(outcomeToErrorCode(outcome), {
      provider: { slug: this.options.providerSlug },
      cause,
      meta: { attempts, durationMs },
    });
  }

  private async prepare(init: HttpRequestInit): Promise<PreparedRequest> {
    const body = init.form
      ? new URLSearchParams(init.form).toString()
      : init.body !== undefined
        ? JSON.stringify(init.body)
        : undefined;

    const prepared: PreparedRequest = {
      method: init.method,
      path: init.path,
      timestamp: Math.floor(this.options.clock.now().getTime() / 1000),
      body,
      headers: {
        accept: 'application/json',
        'user-agent':
          this.options.userAgent ??
          'BaaS-Connector/0.1.0 (+https://github.com/TokenOneBR/BaaS-Connector)',
        ...(this.options.correlationId ? { 'x-correlation-id': this.options.correlationId } : {}),
        ...(init.form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...this.options.defaultHeaders,
        ...init.headers,
      },
    };

    await this.options.auth.apply(prepared);
    return prepared;
  }

  private async send(
    url: string,
    init: HttpRequestInit,
    prepared: PreparedRequest,
    timeouts: Timeouts,
  ): Promise<Dispatcher.ResponseData> {
    return undiciRequest(url, {
      method: init.method,
      headers: prepared.headers,
      body: prepared.body,
      dispatcher: this.options.dispatcher ?? this.agent,
      headersTimeout: timeouts.headersMs,
      bodyTimeout: timeouts.bodyMs,
      // O deadline do chamador vence sobre o nosso: um cliente que nos deu
      // 15s nao pode ficar esperando uma chamada de 20s ao provedor.
      signal: this.options.signal,
      throwOnError: false,
    });
  }

  private async readBody(response: Dispatcher.ResponseData): Promise<unknown> {
    const text = await response.body.text();
    if (text.length === 0) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return { _raw: text };
    }
  }

  private flatHeaders(headers: Dispatcher.ResponseData['headers']): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (value === undefined) continue;
      out[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
    }
    return out;
  }

  private record(
    init: HttpRequestInit,
    prepared: PreparedRequest,
    redaction: RedactionRules,
    result: {
      status?: number;
      body?: unknown;
      durationMs: number;
      attempts: number;
      outcome: ProviderCallRecord['outcome'];
    },
  ): void {
    this.options.onCall?.({
      correlationId: this.options.correlationId ?? '',
      operationId: this.options.operationId,
      connectionId: this.options.connectionId,
      provider: this.options.providerSlug as never,
      environment: this.options.environment as never,
      method: init.method,
      path: init.path,
      endpointClass: init.endpointClass,
      requestHeaders: redactHeaders(prepared.headers, redaction),
      requestBody: init.body !== undefined ? redact(init.body, redaction) : undefined,
      status: result.status,
      responseBody: result.body !== undefined ? redact(result.body, redaction) : undefined,
      durationMs: result.durationMs,
      attempts: result.attempts,
      outcome: result.outcome,
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async close(): Promise<void> {
    await this.agent?.close();
  }
}
