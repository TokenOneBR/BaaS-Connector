import { applyEnvironmentScope, createPrismaClient, type PrismaClient } from '@baasconn/db';
import { getContext } from '@baasconn/observability';
import type { Environment } from '@baasconn/taxonomy';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { ApiConfig } from '../config/config.service.js';

/**
 * Cliente Prisma como provider do Nest.
 *
 * Um unico cliente por processo: cada `new PrismaClient()` abre seu proprio
 * pool, e varios pools no mesmo pod estouram `max_connections` do Postgres
 * muito antes de o trafego justificar.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  /** Cliente cru, sem o escopo de ambiente. Ver `scoped` abaixo. */
  private readonly base: PrismaClient;
  readonly client: PrismaClient;

  constructor(private readonly config: ApiConfig) {
    this.base = createPrismaClient({
      databaseUrl: config.databaseUrl,
      logQueries: !config.isProduction && process.env.LOG_QUERIES === 'true',
    });
    this.client = withEnvironmentScope(this.base);
  }

  async onModuleInit(): Promise<void> {
    // Em teste nao ha banco: conectar aqui transformaria todo teste de unidade
    // numa dependencia de infraestrutura.
    if (this.config.isTest) return;
    await this.base.$connect();
    this.logger.log('Conectado ao Postgres');
  }

  async onModuleDestroy(): Promise<void> {
    await this.base.$disconnect().catch(() => undefined);
  }

  /** Sonda de readiness. Barata de proposito: nao valida schema nem migra. */
  async ping(): Promise<boolean> {
    try {
      await this.base.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Escopo de ambiente como extensao do Prisma.
 *
 * Os repositorios passam `environment` explicitamente — esse e o contrato, e e
 * o que se le na chamada. Esta extensao e a REDE: um `where` esquecido num
 * servico novo continua filtrado, em vez de devolver dados de producao numa
 * resposta de homologacao.
 *
 * O ambiente vem do contexto de requisicao, estabelecido pelo `ApiKeyGuard` a
 * partir do PREFIXO da chave. Fora de uma requisicao — boot, sweeper, worker —
 * nao ha ambiente ambiente e a extensao NAO filtra: silenciosamente assumir um
 * ambiente num job de varredura seria pior do que nao filtrar, porque
 * esconderia metade das linhas sem ninguem notar.
 */
export function withEnvironmentScope(client: PrismaClient): PrismaClient {
  return client.$extends({
    query: {
      $allModels: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async $allOperations({ model, operation, args, query }: any) {
          const environment = getContext()?.environment as Environment | undefined;
          if (!environment) return query(args);
          return query(applyEnvironmentScope(model, operation, args, environment));
        },
      },
    },
  }) as unknown as PrismaClient;
}
