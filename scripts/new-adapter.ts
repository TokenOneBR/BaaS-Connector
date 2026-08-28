#!/usr/bin/env tsx
/**
 * Scaffold de adapter de provedor.
 *
 * Gera um esqueleto HONESTO: manifesto vazio (tudo UNSUPPORTED), factory,
 * health check e o spec de conformidade. O autor vai declarando capacidade
 * por capacidade, e a suite cobra cada declaracao.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const slug = process.argv[2];
if (!slug || !/^[a-z][a-z0-9-]*$/.test(slug)) {
  console.error('Uso: pnpm new:adapter <slug>   (minusculas, digitos e hifen)');
  process.exit(1);
}

const root = join(process.cwd(), 'packages/adapters', slug);
if (existsSync(root)) {
  console.error(`packages/adapters/${slug} ja existe`);
  process.exit(1);
}

const pascal = slug
  .split('-')
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join('');
const upper = slug.replace(/-/g, '_').toUpperCase();

const files: Record<string, string> = {
  'package.json': `{
  "name": "@baasconn/adapter-${slug}",
  "version": "0.1.0",
  "description": "Adapter do ${pascal} para o BaaS Connector",
  "license": "Apache-2.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "files": ["dist"],
  "publishConfig": { "access": "public" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint src",
    "test": "vitest run",
    "test:conformance": "vitest run test/conformance.spec.ts"
  },
  "dependencies": {
    "@baasconn/adapter-kit": "workspace:*",
    "@baasconn/provider-spi": "workspace:*",
    "@baasconn/taxonomy": "workspace:*",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@baasconn/conformance": "workspace:*",
    "@baasconn/tsconfig": "workspace:*",
    "@baasconn/vitest-config": "workspace:*",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
`,
  'tsconfig.json': `{
  "extends": "@baasconn/tsconfig/node22.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
`,
  'vitest.config.ts': `import { nodePreset } from '@baasconn/vitest-config/node';

export default nodePreset({ test: { include: ['test/**/*.spec.ts'] } });
`,
  'README.md': `# Adapter ${pascal}

## Documentacao do provedor

- API: TODO
- Autenticacao: TODO
- Sandbox: TODO

## Capacidades

Ver \`src/manifest.ts\`. A matriz publicada em
\`docs/providers/capability-matrix.md\` e gerada a partir dele.

## Peculiaridades

TODO: o que surpreende quem integra com este provedor. Formato de valor,
comportamento de paginacao, semantica de status, o que a documentacao nao diz.

## Fixtures

Origem: TODO (\`sandbox\` ou \`handcrafted-from-docs\`).

Para regravar, ver \`docs/guides/recording-fixtures.md\`.
`,
  'src/manifest.ts': `import { defineManifest } from '@baasconn/provider-spi';

/**
 * Declare apenas o que esta implementado e testado.
 *
 * Tudo que nao aparece aqui vira UNSUPPORTED automaticamente, e o conector
 * devolve 501 antes de qualquer chamada de rede. Declarar de menos e facil de
 * corrigir; declarar de mais produz erro opaco em producao.
 */
export const ${slug.replace(/-/g, '')}Manifest = defineManifest({
  // 'balance.get': SupportLevel.SUPPORTED,
});
`,
  'src/credentials.ts': `import { z } from 'zod';

/** Validado ANTES de a credencial ser cifrada e gravada. */
export const credentialsSchema = z.object({
  // clientId: z.string().min(1),
  // clientSecret: z.string().min(1),
});

export type ${pascal}Credentials = z.infer<typeof credentialsSchema>;
`,
  'src/endpoints.ts': `/**
 * A suite de conformidade verifica que os dois DIFEREM: homologacao apontando
 * para producao e como se faz uma transferencia real achando que era teste.
 */
export const endpoints = {
  HOMOLOGACAO: 'https://sandbox.${slug}.example.com',
  PRODUCAO: 'https://api.${slug}.example.com',
} as const;
`,
  'src/errors.ts': `import { COMMON_ERROR_MAPPINGS, type ErrorMapping } from '@baasconn/adapter-kit';

/**
 * Mais especifico primeiro.
 *
 * Toda fixture em test/fixtures/errors/ precisa mapear para algo diferente do
 * fallback PROVIDER_REJECTED: e assim que a tabela nao apodrece.
 */
export const errorMappings: readonly ErrorMapping[] = [
  ...COMMON_ERROR_MAPPINGS,
];
`,
  'src/redaction.ts': `import { BASE_REDACTION, extendRedaction } from '@baasconn/adapter-kit';

/** Caminhos sensiveis especificos deste provedor. */
export const redaction = extendRedaction(BASE_REDACTION, {
  maskPaths: [],
});
`,
  'src/adapter.ts': `import type { HealthReport, ProviderAdapter, ProviderContext } from '@baasconn/provider-spi';

export class ${pascal}Adapter implements ProviderAdapter {
  readonly slug = '${upper}';
  readonly displayName = '${pascal}';

  constructor(private readonly ctx: ProviderContext) {}

  async health(): Promise<HealthReport> {
    // Sonda barata. NUNCA entra no readiness do Kubernetes: o provedor ter uma
    // tarde ruim nao pode tirar nossos pods de servico.
    return { healthy: true, checkedAt: this.ctx.runtime.clock.now().toISOString() };
  }
}
`,
  'src/factory.ts': `import type { ProviderAdapterFactory, ProviderContext } from '@baasconn/provider-spi';

import { ${pascal}Adapter } from './adapter.js';
import { credentialsSchema } from './credentials.js';
import { endpoints } from './endpoints.js';
import { ${slug.replace(/-/g, '')}Manifest } from './manifest.js';

export const ${slug.replace(/-/g, '')}Factory: ProviderAdapterFactory = {
  slug: '${upper}',
  displayName: '${pascal}',
  manifest: ${slug.replace(/-/g, '')}Manifest,
  credentialsSchema,
  endpoints,
  idempotency: {},
  docsUrl: 'TODO',
  create: (ctx: ProviderContext) => new ${pascal}Adapter(ctx),
};
`,
  'src/index.ts': `export { ${slug.replace(/-/g, '')}Factory } from './factory.js';
export { ${slug.replace(/-/g, '')}Manifest } from './manifest.js';
`,
  'test/fixtures/index.ts': `import type { Cassette } from '@baasconn/adapter-kit/testing';

export const happyPath: readonly Cassette[] = [];

/** Sem fixture de erro, a tabela de mapeamento nunca e exercitada. */
export const errors: readonly Cassette[] = [];
`,
  'test/conformance.spec.ts': `import { runConformanceSuite } from '@baasconn/conformance';

import { ${slug.replace(/-/g, '')}Factory } from '../src/index.js';

import { errors, happyPath } from './fixtures/index.js';

runConformanceSuite({
  factory: ${slug.replace(/-/g, '')}Factory,
  credentials: {},
  fixtures: { happyPath, errors },
});
`,
};

for (const [relative, content] of Object.entries(files)) {
  const path = join(root, relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

const changeset = join(process.cwd(), '.changeset', `adapter-${slug}.md`);
writeFileSync(
  changeset,
  `---
"@baasconn/adapter-${slug}": minor
---

Adiciona o esqueleto do adapter ${pascal}.
`,
);

console.warn(`
Adapter criado em packages/adapters/${slug}

Proximos passos:
  1. pnpm install
  2. Preencha src/manifest.ts com o que o provedor REALMENTE oferece
  3. Preencha src/credentials.ts e src/endpoints.ts
  4. Implemente a autenticacao em src/auth.ts
  5. Preencha a matriz em src/errors.ts
  6. Uma capacidade por vez, cada uma com fixture e conformidade verde

Leia docs/guides/writing-a-provider-adapter.md antes.
`);
