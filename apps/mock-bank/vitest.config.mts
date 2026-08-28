import { nodePreset } from '@baasconn/vitest-config/node';

export default nodePreset({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.spec.ts'],
    coverage: { thresholds: { lines: 75, branches: 65, functions: 75, statements: 75 } },
  },
});
