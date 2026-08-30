import { existsSync } from 'node:fs';

import { defineConfig, devices } from '@playwright/test';

import { PORTS } from './console/config.js';

const WEB = `http://127.0.0.1:${PORTS.web}`;

/**
 * Chromium ja instalado no ambiente, quando ha um.
 *
 * Alguns ambientes de execucao trazem o navegador pre-instalado e bloqueiam o
 * download de outro; a versao pode nao ser a que este `@playwright/test`
 * baixaria. Um caminho cravado quebraria no CI e nenhum quebraria la, entao a
 * existencia do arquivo e que decide.
 */
const CHROMIUM_LOCAL = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/**
 * Playwright do console.
 *
 * Dois servidores: o harness (API + Mock Bank em processo, com repositorios
 * em memoria) e o `next start` do console apontando para ele. Nao ha Postgres
 * nem Redis — o que se prova aqui e a INTERFACE e a fronteira do BFF; o SQL
 * continua provado em `packages/db` e o fluxo de dinheiro em `e2e/api`.
 *
 * `pt-BR` e `America/Sao_Paulo` cravados: as telas formatam dinheiro e data
 * com `Intl`, e um runner em UTC produziria assercao que passa na maquina de
 * quem escreveu e falha no CI.
 */
export default defineConfig({
  testDir: './console',
  testMatch: '**/*.spec.ts',
  // Um harness so, com estado em memoria compartilhado: dois workers
  // gravando na mesma conta produziriam intermitencia que nao e do produto.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,

  use: {
    baseURL: WEB,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    // Rastro so na primeira repeticao: guardar rastro de tudo enche o
    // artefato do CI com execucoes verdes que ninguem abre.
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(existsSync(CHROMIUM_LOCAL)
          ? { launchOptions: { executablePath: CHROMIUM_LOCAL } }
          : {}),
      },
    },
  ],

  webServer: [
    {
      command:
        'pnpm exec vite-node --config console/vite-node.config.mts console/harness-server.ts',
      url: `http://127.0.0.1:${PORTS.api}/healthz`,
      // NUNCA reusa, e a razao vale para os dois servidores: o estado do
      // harness e todo EM MEMORIA e nasce de novo a cada execucao, com par
      // RSA e ids novos. Um `next start` sobrevivente de uma execucao
      // anterior apontaria para um harness morto ou para outro, e o sintoma
      // seria um login que falha com "e-mail ou senha invalidos" — que
      // manda quem esta depurando procurar o bug no lugar errado.
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // `start`, e nao `dev`: o que vai a producao e o build, e a compilacao
      // sob demanda do `dev` esconde erro de renderizacao no servidor atras
      // de um overlay que o Playwright interpreta como pagina valida.
      command: `pnpm --filter @baasconn/web exec next start --port ${PORTS.web}`,
      url: `${WEB}/login`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        API_INTERNAL_URL: `http://127.0.0.1:${PORTS.api}`,
        // Os cookies saem `Secure` porque `next start` roda em producao — e
        // e assim que devem sair. Nao ha escape hatch aqui de proposito: o
        // Chromium aceita cookie `Secure` vindo de `127.0.0.1`, tratando-o
        // como origem segura, entao o teste exercita a configuracao REAL em
        // vez de uma enfraquecida so para ele.
        MOCK_BANK_URL: `http://127.0.0.1:${PORTS.mockBank}`,
      },
    },
  ],
});
