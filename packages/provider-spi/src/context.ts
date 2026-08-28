import type { Clock, Environment, ProviderSlug } from '@baasconn/taxonomy';

/**
 * Blob de credenciais, opaco para o core.
 *
 * A forma e validada pelo `credentialsSchema` do proprio adapter antes de ser
 * cifrada, entao o core nunca precisa saber o que ha dentro.
 */
export type ProviderCredentials = Readonly<Record<string, unknown>>;

export interface ActorRef {
  type: 'API_KEY' | 'USER' | 'SYSTEM';
  id: string;
  label?: string;
}

export interface ScopedLogger {
  debug(payload: Record<string, unknown>, message?: string): void;
  info(payload: Record<string, unknown>, message?: string): void;
  warn(payload: Record<string, unknown>, message?: string): void;
  error(payload: Record<string, unknown>, message?: string): void;
  child(bindings: Record<string, unknown>): ScopedLogger;
}

export interface Token {
  accessToken: string;
  expiresInSeconds: number;
  tokenType?: string;
  scope?: string;
}

/**
 * Cache de token com single-flight.
 *
 * Sem coalescencia, 200 requisicoes concorrentes num token expirado viram 200
 * chamadas ao endpoint de token do provedor, e isso derruba a conexao por
 * rate limit no pior momento possivel.
 */
export interface TokenStore {
  getOrFetch(key: string, fetch: () => Promise<Token>): Promise<Token>;
  invalidate(key: string): Promise<void>;
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreaker {
  /** Lanca `BaasError(PROVIDER_CIRCUIT_OPEN)` quando aberto. */
  assertClosed(key: string): Promise<void>;
  recordSuccess(key: string): Promise<void>;
  recordFailure(key: string): Promise<void>;
  state(key: string): Promise<CircuitState>;
}

/** Registro de uma chamada de saida, ja redigido, para auditoria e metrica. */
export interface ProviderCallRecord {
  correlationId: string;
  operationId?: string;
  connectionId: string;
  provider: ProviderSlug;
  environment: Environment;
  method: string;
  /** Apenas o caminho; a query e redigida. */
  path: string;
  endpointClass: EndpointClass;
  requestHeaders: Record<string, string>;
  requestBody?: unknown;
  status?: number;
  responseBody?: unknown;
  providerRequestId?: string;
  durationMs: number;
  attempts: number;
  outcome: 'ok' | 'provider_error' | 'network_error' | 'timeout' | 'circuit_open' | 'unknown';
  canonicalErrorCode?: string;
}

/** Classe do endpoint: dirige timeout, breaker e metrica. */
export type EndpointClass = 'read' | 'write' | 'auth' | 'upload';

/** Servicos que o core injeta, para o adapter nunca precisar importar o core. */
export interface AdapterRuntime {
  readonly tokenStore: TokenStore;
  readonly breaker: CircuitBreaker;
  readonly clock: Clock;
  readonly recordCall: (record: ProviderCallRecord) => void;
}

/**
 * Contexto de uma operacao.
 *
 * Credenciais chegam por aqui, em tempo de chamada. Elas nunca entram no grafo
 * de injecao de dependencia no boot: sao por conexao e por ambiente, e um
 * singleton nao consegue representar isso sem virar um mapa global mutavel.
 */
export interface ProviderContext {
  readonly connectionId: string;
  readonly provider: ProviderSlug;
  readonly environment: Environment;
  readonly baseUrl: string;
  readonly credentials: ProviderCredentials;
  /** Configuracao nao secreta: ISPB, conta principal, identificadores. */
  readonly config: Readonly<Record<string, unknown>>;

  /** Igual ao X-Request-Id da requisicao de entrada. Propagado na saida. */
  readonly correlationId: string;
  /** ULID da operacao mutante; vira a chave de idempotencia do provedor. */
  readonly operationId?: string;
  readonly actor: ActorRef;

  readonly runtime: AdapterRuntime;
  readonly logger: ScopedLogger;
  /** Deadline da requisicao de entrada. Um cliente que deu 15s nao espera 20s. */
  readonly signal?: AbortSignal;
}
