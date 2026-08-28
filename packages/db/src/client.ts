import { PrismaClient } from '@prisma/client';

export type { PrismaClient } from '@prisma/client';
export * from '@prisma/client';

export interface PrismaOptions {
  databaseUrl: string;
  logQueries?: boolean;
}

/**
 * Cliente Prisma com serializacao de BigInt.
 *
 * `JSON.stringify(1n)` lanca. Como TODO valor monetario no schema e BIGINT,
 * qualquer resposta que carregue dinheiro explodiria na serializacao sem este
 * patch. E preferivel resolver uma vez aqui a espalhar `.toString()` por
 * dezenas de mappers e descobrir o que faltou em producao.
 */
export function installBigIntSerializer(): void {
  const proto = BigInt.prototype as unknown as { toJSON?: () => string };
  if (!proto.toJSON) {
    proto.toJSON = function toJSON(this: bigint): string {
      return this.toString();
    };
  }
}

export function createPrismaClient(options: PrismaOptions): PrismaClient {
  installBigIntSerializer();
  return new PrismaClient({
    datasources: { db: { url: options.databaseUrl } },
    log: options.logQueries ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
}
