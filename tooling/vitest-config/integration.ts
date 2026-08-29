import type { UserConfig } from 'vitest/config';
// `./node.ts`, e nao `./node.js`: estes presets sao consumidos como fonte, sem
// passo de build, e o resolvedor de ESM do Node procura o arquivo literal. O
// import errado nunca apareceu porque nenhum pacote chegou a usar este preset.
import { nodePreset } from './node.ts';

/** Testes de integracao: Testcontainers, sem paralelismo entre arquivos, timeout alto. */
export function integrationPreset(overrides: UserConfig = {}): UserConfig {
  return nodePreset({
    ...overrides,
    test: {
      include: ['test/integration/**/*.{test,spec}.ts'],
      testTimeout: 120_000,
      hookTimeout: 180_000,
      fileParallelism: false,
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } },
      ...overrides.test,
    },
  });
}

export default integrationPreset;
