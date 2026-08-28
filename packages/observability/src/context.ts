import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Contexto de requisicao.
 *
 * `AsyncLocalStorage` e nao provider request-scoped do Nest: escopo de
 * requisicao no Nest envenena a arvore de injecao (tudo que depende dele vira
 * request-scoped) e custa throughput. O contexto ambiente resolve o mesmo
 * problema sem esse efeito.
 */
export interface RequestContext {
  requestId: string;
  correlationId: string;
  environment?: string;
  apiKeyId?: string;
  userId?: string;
  actorType?: 'API_KEY' | 'USER' | 'SYSTEM';
  connectionId?: string;
  provider?: string;
  operationId?: string;
  idempotencyKey?: string;
  traceId?: string;
  spanId?: string;
  startedAtMs: number;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

export function requireContext(): RequestContext {
  const context = storage.getStore();
  if (!context) {
    throw new Error(
      'Nenhum contexto de requisicao ativo. Trabalho em background precisa ' +
        'ser envolvido em runWithContext para o log ficar correlacionavel.',
    );
  }
  return context;
}

/** Enriquece o contexto atual, para camadas mais internas anotarem o log. */
export function enrichContext(patch: Partial<RequestContext>): void {
  const context = storage.getStore();
  if (context) Object.assign(context, patch);
}

/** Campos que todo log carrega, sem o chamador precisar passar. */
export function contextBindings(): Record<string, unknown> {
  const context = storage.getStore();
  if (!context) return {};
  return {
    request_id: context.requestId,
    correlation_id: context.correlationId,
    environment: context.environment,
    api_key_id: context.apiKeyId,
    user_id: context.userId,
    connection_id: context.connectionId,
    provider: context.provider,
    operation_id: context.operationId,
    trace_id: context.traceId,
    span_id: context.spanId,
  };
}
