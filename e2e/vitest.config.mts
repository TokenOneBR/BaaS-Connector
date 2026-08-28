import { nodePreset } from '@baasconn/vitest-config/node';

export default nodePreset({
  test: {
    include: ['api/**/*.spec.ts'],
    // Sobe dois servidores Nest por arquivo; o padrao de 5s nao basta.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
