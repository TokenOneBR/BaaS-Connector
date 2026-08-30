import { nodePreset } from '@baasconn/vitest-config/node';

export default nodePreset({ test: { include: ['test/**/*.spec.ts'] } });
