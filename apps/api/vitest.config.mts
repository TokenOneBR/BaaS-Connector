import { nodePreset } from '@baasconn/vitest-config/node';

export default nodePreset({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.spec.ts'],
    exclude: ['test/integration/**'],
    coverage: { thresholds: { lines: 70, branches: 60, functions: 70, statements: 70 } },
  },
});
