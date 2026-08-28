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
} satisfies PrismaConfig;
