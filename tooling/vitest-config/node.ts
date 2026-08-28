import swc from 'unplugin-swc';
import { defineConfig, type UserConfig } from 'vitest/config';

/**
 * Preset Node/NestJS.
 *
 * unplugin-swc e nao esbuild: apenas o SWC emite `emitDecoratorMetadata`,
 * que o container de DI do Nest exige para resolver dependencias por tipo.
 */
export function nodePreset(overrides: UserConfig = {}): UserConfig {
  return defineConfig({
    plugins: [
      swc.vite({
        module: { type: 'es6' },
        jsc: {
          target: 'es2022',
          parser: { syntax: 'typescript', decorators: true },
          transform: { legacyDecorator: true, decoratorMetadata: true },
        },
      }),
    ],
    ...overrides,
    test: {
      globals: true,
      environment: 'node',
      pool: 'threads',
      include: ['src/**/*.{test,spec}.ts', 'test/**/*.{test,spec}.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'lcov', 'json-summary'],
        exclude: ['**/dist/**', '**/*.d.ts', '**/index.ts', '**/*.config.*', '**/test/**'],
      },
      ...overrides.test,
    },
  }) as UserConfig;
}

export default nodePreset;
