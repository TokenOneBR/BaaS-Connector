import {
  InMemoryCircuitBreaker,
  InMemoryTokenStore,
} from '@baasconn/adapter-kit';
import { getContext } from '@baasconn/observability';
import type {
  AdapterRuntime,
  ProviderAdapter,
  ProviderCallRecord,
  ProviderContext,
  ScopedLogger,
} from '@baasconn/provider-spi';
import { CapabilityNotSupportedError, SupportLevel, systemClock, type CapabilityKey } from '@baasconn/taxonomy';
import { Inject, Injectable } from '@nestjs/common';

import { CredentialResolver } from './credential.resolver.js';
import { ProviderRegistry } from './provider.registry.js';

export interface BoundProvider {
  adapter: ProviderAdapter;
  context: ProviderContext;
  slug: string;
}

export const PROVIDER_CALL_SINK = Symbol('BAAS_PROVIDER_CALL_SINK');

export const SCOPED_LOGGER = Symbol('BAAS_SCOPED_LOGGER');

/** Consumidor dos registros de chamada. Grava em provider_call e em metrica. */
export interface ProviderCallSink {
  record(call: ProviderCallRecord): void;
}

/**
 * Liga um adapter a uma conexao, em tempo de chamada.
 *
 * Singleton de proposito. Provider request-scoped do Nest envenena a arvore de
 * injecao (tudo que depende dele vira request-scoped) e custa throughput; o
 * contexto ambiente do AsyncLocalStorage resolve o mesmo problema sem isso.
 */
@Injectable()
export class ProviderResolver {
  private readonly tokenStore = new InMemoryTokenStore(systemClock);
  private readonly breaker = new InMemoryCircuitBreaker(systemClock);

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly credentials: CredentialResolver,
    @Inject(PROVIDER_CALL_SINK) private readonly sink: ProviderCallSink,
    @Inject(SCOPED_LOGGER) private readonly logger: ScopedLogger,
  ) {}

  async resolve(connectionId: string, options: { operationId?: string } = {}): Promise<BoundProvider> {
    const connection = await this.credentials.resolve(connectionId);
    const factory = this.registry.factory(connection.provider);
    const requestContext = getContext();

    const runtime: AdapterRuntime = {
      tokenStore: this.tokenStore,
      breaker: this.breaker,
      clock: systemClock,
      recordCall: (call) => this.sink.record(call),
    };

    const context: ProviderContext = {
      connectionId: connection.id,
      provider: connection.provider as never,
      environment: connection.environment,
      baseUrl: connection.baseUrl ?? factory.endpoints[connection.environment],
      credentials: connection.credentials,
      config: connection.config,
      correlationId: requestContext?.correlationId ?? 'sem-correlacao',
      operationId: options.operationId ?? requestContext?.operationId,
      actor: {
        type: requestContext?.actorType ?? 'SYSTEM',
        id: requestContext?.apiKeyId ?? requestContext?.userId ?? 'system',
      },
      logger: this.logger.child({
        provider: connection.provider,
        connection_id: connection.id,
        environment: connection.environment,
      }),
      runtime,
    };

    return { adapter: factory.create(context), context, slug: connection.provider };
  }

  /**
   * Resolve exigindo uma capacidade.
   *
   * Lanca 501 ANTES de qualquer chamada de rede, com a nota do manifesto.
   */
  async require(
    connectionId: string,
    capability: CapabilityKey,
    options: { operationId?: string } = {},
  ): Promise<BoundProvider> {
    const bound = await this.resolve(connectionId, options);
    const entry = this.registry.factory(bound.slug).manifest[capability];

    if (entry.level === SupportLevel.UNSUPPORTED) {
      throw new CapabilityNotSupportedError(bound.slug, capability, entry.note);
    }

    return bound;
  }
}
