import { nodePreset } from '@baasconn/vitest-config/node';

export default nodePreset({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['test/integration/**'],
    /**
     * `forks`, e nao `threads`.
     *
     * Os testes deste pacote importam `@baasconn/api/testing`, que arrasta o
     * grafo da API inteiro — incluindo `argon2` e o cliente do Prisma, os dois
     * addons NATIVOS. Descarregar um addon nativo de uma worker thread aborta
     * o processo com `Napi::Error` DEPOIS de todos os testes passarem: a saida
     * diz "50 passed" e o exit code e 134, que e a pior combinacao possivel
     * para quem esta lendo um log de CI.
     *
     * `forks` da um processo de verdade por arquivo, e um processo que sai nao
     * precisa descarregar addon nenhum. Custa alguns milissegundos de
     * inicializacao e troca uma suite que aborta por uma que termina.
     */
    pool: 'forks',
    coverage: { thresholds: { lines: 70, branches: 60, functions: 70, statements: 70 } },
  },
});
