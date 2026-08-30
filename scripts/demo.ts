/**
 * Modo demonstracao: a stack inteira num processo so, sem infraestrutura.
 *
 * Sobe Mock Bank + API + console em portas fixas, com um usuario de console,
 * uma conexao de provedor e uma API key ja prontos, e imprime as credenciais.
 * Nao precisa de Docker, Postgres nem Redis — o objetivo e alguem conseguir
 * ver o produto funcionando em menos de um minuto.
 *
 * O QUE ISSO NAO E: producao. Os repositorios sao EM MEMORIA, entao nada
 * sobrevive a um restart. Para persistencia de verdade — e para guardar a
 * credencial de um provedor real — use `pnpm up`, que sobe Postgres e Redis.
 *
 * Reusa `startHarness`, que e o mesmo boot que os testes e2e exercitam. Um
 * segundo caminho de inicializacao divergiria do que a suite prova, e o modo
 * demo — que e o primeiro contato de qualquer pessoa com o projeto — seria
 * justamente o que ninguem testa.
 */
import { spawn, type ChildProcess } from 'node:child_process';

import { startHarness } from '@baasconn/e2e/harness';
import { encodeBase32, totpCode } from '@baasconn/crypto';
import { ConsoleRole } from '@baasconn/taxonomy';

const PORTAS = { api: 3001, mockBank: 3002, web: 3000 } as const;
const EMAIL = 'admin@local.test';
const SENHA = 'baas-connector-demo';

const semConsole = process.argv.includes('--sem-console');

function faixa(texto: string): void {
  console.warn(`\n${'─'.repeat(68)}\n  ${texto}\n${'─'.repeat(68)}`);
}

async function main(): Promise<void> {
  console.warn('\nSubindo Mock Bank e API...');

  const harness = await startHarness({
    consoleUser: { email: EMAIL, password: SENHA, role: ConsoleRole.OWNER },
    ports: { api: PORTAS.api, mockBank: PORTAS.mockBank },
  });

  let console_: ChildProcess | undefined;
  if (!semConsole) {
    console.warn('Subindo o console...');
    console_ = spawn(
      'pnpm',
      ['--filter', '@baasconn/web', 'exec', 'next', 'start', '--port', String(PORTAS.web)],
      {
        stdio: 'ignore',
        env: {
          ...process.env,
          NODE_ENV: 'production',
          API_INTERNAL_URL: harness.apiUrl,
          MOCK_BANK_URL: harness.mockBankUrl,
        },
      },
    );
  }

  faixa('PRONTO — dados em memoria, nada persiste');

  console.warn(`
  Console      http://localhost:${PORTAS.web}
  API          ${harness.apiUrl}/v1
  Mock Bank    ${harness.mockBankUrl}
  OpenAPI      ${harness.apiUrl}/docs/v1

  Entrar no console:
    e-mail     ${EMAIL}
    senha      ${SENHA}

  API key (header Authorization: Bearer):

    ${harness.apiKey}

  Segredo de assinatura (so as rotas de dinheiro exigem):

    ${harness.signingSecret}

  Conexao Mock Bank ja criada: ${harness.connectionId}
`);

  if (harness.consoleTotpSecret) {
    const base32 = encodeBase32(harness.consoleTotpSecret);
    console.warn(`  O console pede um codigo de 6 digitos: OWNER exige 2FA, e essa
  regra vale tambem no demo — contorna-la aqui esconderia dela quem
  esta avaliando justamente a postura de seguranca do produto.

    codigo agora   ${totpCode(harness.consoleTotpSecret, new Date())}   (expira em ate 30s)
    segredo        ${base32}

  Para nao depender do relogio, adicione o segredo ao seu autenticador:
    otpauth://totp/BaaS%20Connector:${encodeURIComponent(EMAIL)}?secret=${base32}&issuer=BaaS%20Connector
`);
  }

  faixa('Ctrl+C para parar');

  const parar = async (): Promise<void> => {
    console_?.kill();
    await harness.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void parar());
  process.on('SIGTERM', () => void parar());
}

void main();
