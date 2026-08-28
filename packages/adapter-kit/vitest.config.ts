import { nodePreset } from '@baasconn/vitest-config/node';

export default nodePreset({
  test: { coverage: { thresholds: { lines: 90, branches: 80, functions: 90, statements: 90 } } },
});
