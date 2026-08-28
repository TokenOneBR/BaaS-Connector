import type { UserConfig } from 'vitest/config';
import { nodePreset } from './node.js';

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
