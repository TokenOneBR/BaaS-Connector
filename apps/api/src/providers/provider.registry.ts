import {
  assertManifestValid,
  type CapabilityEntry,
  type ProviderAdapterFactory,
} from '@baasconn/provider-spi';
import { BaasError, BaasErrorCode, SupportLevel, type CapabilityKey } from '@baasconn/taxonomy';
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';

export const PROVIDER_FACTORIES = Symbol('BAAS_PROVIDER_FACTORIES');

/** Resolve a conexao para o slug do provedor. Implementado sobre Prisma. */
export interface ConnectionLookup {
  slugOf(connectionId: string): Promise<string | undefined>;
}

export const CONNECTION_LOOKUP = Symbol('BAAS_CONNECTION_LOOKUP');

/**
 * Registro de provedores.
 *
 * Os adapters sao compilados junto, nao carregados dinamicamente. Carregamento
 * em runtime derrota a validacao de manifesto no boot e o manifesto tipado, que
 * sao justamente as duas coisas que impedem um adapter prometer capacidade que
 * nao tem. Quem quiser um adapter privado publica `@sua-org/baas-provider-x` e
 * adiciona uma linha na raiz de composicao.
 */
@Injectable()
export class ProviderRegistry implements OnModuleInit {
  private readonly bySlug = new Map<string, ProviderAdapterFactory>();

  constructor(
    @Inject(PROVIDER_FACTORIES) private readonly factories: ProviderAdapterFactory[],
    @Inject(CONNECTION_LOOKUP) private readonly connections: ConnectionLookup,
  ) {}

  onModuleInit(): void {
    for (const factory of this.factories) {
      if (this.bySlug.has(factory.slug)) {
        throw new Error(`Slug de provedor duplicado: ${factory.slug}`);
      }

      // Falha rapido: um manifesto que promete pix.out.send sem a faceta
      // pixTransfers e um bug que so apareceria na primeira transferencia de
      // producao.
      const probe = factory.create({
        connectionId: 'boot-validation',
        provider: factory.slug as never,
        environment: 'HOMOLOGACAO' as never,
        baseUrl: factory.endpoints.HOMOLOGACAO,
        credentials: {},
        config: {},
        correlationId: 'boot',
        actor: { type: 'SYSTEM', id: 'boot' },
        logger: NOOP_LOGGER,
        runtime: NOOP_RUNTIME,
      });
      assertManifestValid(factory, probe);

      this.bySlug.set(factory.slug, factory);
    }
  }

  factory(slug: string): ProviderAdapterFactory {
    const factory = this.bySlug.get(slug);
    if (!factory) {
      throw new BaasError(BaasErrorCode.PROVIDER_NOT_FOUND, {
        message: `Provedor '${slug}' nao esta registrado neste deploy.`,
      });
    }
    return factory;
  }

  list(): ProviderAdapterFactory[] {
    return [...this.bySlug.values()];
  }

  async slugFor(connectionId: string): Promise<string> {
    const slug = await this.connections.slugOf(connectionId);
    if (!slug) {
      throw new BaasError(BaasErrorCode.CONNECTION_NOT_FOUND, {
        message: `Conexao '${connectionId}' nao encontrada.`,
      });
    }
    return slug;
  }

  async capabilityFor(connectionId: string, capability: CapabilityKey): Promise<CapabilityEntry> {
    return this.factory(await this.slugFor(connectionId)).manifest[capability];
  }

  supports(slug: string, capability: CapabilityKey): boolean {
    return this.factory(slug).manifest[capability].level !== SupportLevel.UNSUPPORTED;
  }
}

const NOOP_LOGGER = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => NOOP_LOGGER,
};

/**
 * Runtime inerte para a validacao de boot.
 *
 * `create()` precisa ser barata e sem I/O, entao um runtime que lanca ao ser
 * usado e suficiente: se algum adapter tentar fazer I/O no construtor, o boot
 * falha, que e exatamente o que queremos.
 */
const NOOP_RUNTIME = {
  tokenStore: {
    getOrFetch: () => Promise.reject(new Error('runtime nao disponivel na validacao de boot')),
    invalidate: () => Promise.resolve(),
  },
  breaker: {
    assertClosed: () => Promise.resolve(),
    recordSuccess: () => Promise.resolve(),
    recordFailure: () => Promise.resolve(),
    state: () => Promise.resolve('CLOSED' as const),
  },
  clock: { now: () => new Date() },
  recordCall: () => undefined,
};
