import { nodePreset } from '@baasconn/vitest-config/node';

export default nodePreset({
  test: { coverage: { thresholds: { lines: 95, branches: 90, functions: 95, statements: 95 } } },
});
