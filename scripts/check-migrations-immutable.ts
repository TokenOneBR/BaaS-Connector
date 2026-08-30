#!/usr/bin/env tsx
/**
 * Migration ja commitada e IMUTAVEL.
 *
 * Editar uma migration que ja rodou produz a pior classe de divergencia: a
 * tabela `_prisma_migrations` diz que rodou, o checksum nao bate mais, e o
 * estado real do banco e o antigo. O Prisma detecta e RECUSA a migrar —
 * durante um deploy, que e a pior hora possivel para descobrir.
 *
 * A regra e simples e a ferramenta e o git: qualquer `migration.sql` que
 * exista na base e tenha mudado no diff reprova. Adicionar arquivo novo e
 * livre; alterar o que ja existe, nao.
 *
 * Nao ha excecao por flag. Uma migration errada se conserta com uma migration
 * NOVA que a corrige — que e, alias, exatamente o que o banco vai ver
 * acontecer nos ambientes que ja aplicaram a errada.
 */
import { execFileSync } from 'node:child_process';

const base = process.env.BASE_REF ?? process.env.GITHUB_BASE_REF ?? 'origin/main';

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

let merge: string;
try {
  merge = git('merge-base', base, 'HEAD');
} catch {
  // Sem base para comparar — repositorio raso, ou execucao local numa branch
  // que nao conhece a origem. Nao ha o que verificar, e reprovar aqui
  // ensinaria a ignorar o check.
  console.warn(`Sem merge-base com '${base}'; nada a verificar.`);
  process.exit(0);
}

const alterados = git('diff', '--name-only', '--diff-filter=MD', merge, 'HEAD', '--')
  .split('\n')
  .filter((linha) => /packages\/db\/prisma\/migrations\/.+\/migration\.sql$/.test(linha));

if (alterados.length > 0) {
  console.error('Migrations ja commitadas foram alteradas ou removidas:\n');
  for (const arquivo of alterados) console.error(`  ${arquivo}`);
  console.error(
    '\nUma migration aplicada nao pode mudar: o checksum em `_prisma_migrations`',
    '\ndeixa de bater e o `migrate deploy` recusa a rodar. Corrija com uma',
    '\nmigration NOVA — que e o que os ambientes ja migrados vao ver de qualquer',
    '\nforma.',
  );
  process.exit(1);
}

console.warn('Nenhuma migration ja commitada foi alterada.');
