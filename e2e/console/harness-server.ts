/**
 * Sobe API + Mock Bank em portas FIXAS, para o Playwright ter o que apontar.
 *
 * E o mesmo `startHarness` dos specs de API. Um segundo caminho de montagem
 * divergiria do que os outros specs exercitam, e o console passaria a ser
 * testado contra um servidor que mais ninguem usa — que e como uma suite de
 * UI fica verde sobre um backend que nao existe.
 *
 * Escreve `.harness.json` com as URLs e o id da conexao semeada. Um arquivo,
 * e nao uma variavel de ambiente: o Playwright inicia o `next start` em
 * paralelo, e ele nao herdaria nada decidido aqui.
 */
import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ConsoleRole } from '@baasconn/taxonomy';

import { startHarness } from '../support/harness.js';

import { CONSOLE_LOGIN, HARNESS_STATE_FILE, PORTS } from './config.js';

async function main(): Promise<void> {
  // Par RSA efemero, gerado por execucao.
  //
  // O `startHarness` nao os define porque os specs de API entram por API key
  // e nunca emitem JWT de console. Aqui o login E o caminho, entao sem o par
  // a rota falha com 500 — e o BFF, que traduz todo nao-ok para "e-mail ou
  // senha invalidos", esconderia a causa real por tras de uma mensagem que
  // parece de credencial.
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.JWT_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  process.env.JWT_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();

  const harness = await startHarness({
    consoleUser: { ...CONSOLE_LOGIN, role: ConsoleRole.OPERATOR },
    ports: { api: PORTS.api, mockBank: PORTS.mockBank },
  });

  writeFileSync(
    join(import.meta.dirname, HARNESS_STATE_FILE),
    JSON.stringify(
      {
        apiUrl: harness.apiUrl,
        mockBankUrl: harness.mockBankUrl,
        connectionId: harness.connectionId,
      },
      null,
      2,
    ),
  );

  const encerrar = async (): Promise<void> => {
    await harness.stop();
    process.exit(0);
  };
  process.on('SIGTERM', () => void encerrar());
  process.on('SIGINT', () => void encerrar());
}

void main();
