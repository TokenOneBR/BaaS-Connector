import { nodePreset } from '@baasconn/vitest-config/node';

export default nodePreset({
  test: {
    include: ['test/**/*.spec.ts', 'src/**/*.test.ts'],
    // PGlite compila Postgres para WASM: sobe em ~1s, mas nao em milissegundos.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
