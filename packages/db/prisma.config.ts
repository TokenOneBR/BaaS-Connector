import path from 'node:path';

import type { PrismaConfig } from 'prisma';

/**
 * Schema em pasta: um arquivo por dominio.
 *
 * Um schema.prisma unico com ~40 modelos vira ilegivel, e todo PR que toca
 * qualquer tabela mostra conflito no mesmo arquivo.
 */
export default {
  schema: path.join('prisma', 'schema'),

  /**
   * Caminho das migrations, EXPLICITO.
   *
   * Com `schema` apontando para uma pasta, o Prisma procura as migrations em
   * `prisma/schema/migrations` — que nao existe. O sintoma era o pior
   * possivel: `migrate deploy` respondia "No migration found" e saia com
   * codigo 0, entao o gate do CI que promete "as migrations aplicam num banco
   * limpo" passava sem aplicar nada.
   */
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
} satisfies PrismaConfig;
