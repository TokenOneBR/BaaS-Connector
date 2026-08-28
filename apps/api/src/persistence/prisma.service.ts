import { createPrismaClient, type PrismaClient } from '@baasconn/db';
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
  readonly client: PrismaClient;

  constructor(private readonly config: ApiConfig) {
    this.client = createPrismaClient({
      databaseUrl: config.databaseUrl,
      logQueries: !config.isProduction && process.env.LOG_QUERIES === 'true',
    });
  }

  async onModuleInit(): Promise<void> {
    // Em teste nao ha banco: conectar aqui transformaria todo teste de unidade
    // numa dependencia de infraestrutura.
    if (this.config.isTest) return;
    await this.client.$connect();
    this.logger.log('Conectado ao Postgres');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect().catch(() => undefined);
  }

  /** Sonda de readiness. Barata de proposito: nao valida schema nem migra. */
  async ping(): Promise<boolean> {
    try {
      await this.client.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
