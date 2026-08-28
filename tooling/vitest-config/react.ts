import { defineConfig, type UserConfig } from 'vitest/config';

export function reactPreset(overrides: UserConfig = {}): UserConfig {
  return defineConfig({
    ...overrides,
    test: {
      globals: true,
      environment: 'jsdom',
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      coverage: { provider: 'v8', reporter: ['text', 'lcov', 'json-summary'] },
      ...overrides.test,
    },
  }) as UserConfig;
}

export default reactPreset;
