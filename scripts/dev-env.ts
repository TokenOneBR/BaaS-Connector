#!/usr/bin/env tsx
/**
 * Prepara o `.env` local antes de `docker compose up`.
 *
 * O compose EXIGE `JWT_PRIVATE_KEY` e `JWT_PUBLIC_KEY` (`${VAR:?...}`) em vez
 * de trazer um par embutido, e a diferenca importa: uma chave de assinatura
 * de sessao committada no repositorio e uma chave que alguem promove para
 * producao sem notar, e que qualquer pessoa com o repositorio consegue usar
 * para forjar um token de ADMIN.
 *
 * Entao o par e gerado AQUI, na maquina de quem sobe a stack, e escrito num
 * `.env` que o `.gitignore` ja recusa. Idempotente: se o arquivo ja existe
 * com as duas chaves, nao mexe.
 */
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ENV = join(process.cwd(), '.env');
const EXEMPLO = join(process.cwd(), '.env.example');

const atual = existsSync(ENV) ? readFileSync(ENV, 'utf8') : readFileSync(EXEMPLO, 'utf8');

if (/^JWT_PRIVATE_KEY=.+/m.test(atual) && /^JWT_PUBLIC_KEY=.+/m.test(atual)) {
  console.warn('.env ja tem o par de chaves; nada a fazer.');
  process.exit(0);
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

// Uma linha so, com `\n` escapado: o formato que `docker compose` e o
// `dotenv` do Node leem sem precisar de aspas multilinha, que as duas
// implementacoes tratam de forma diferente.
const emUmaLinha = (pem: string): string => pem.trim().replace(/\n/g, '\\n');

const conteudo = atual
  .replace(
    /^JWT_PRIVATE_KEY=.*$/m,
    `JWT_PRIVATE_KEY="${emUmaLinha(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())}"`,
  )
  .replace(
    /^JWT_PUBLIC_KEY=.*$/m,
    `JWT_PUBLIC_KEY="${emUmaLinha(publicKey.export({ type: 'spki', format: 'pem' }).toString())}"`,
  );

writeFileSync(ENV, conteudo);
console.warn('.env escrito com um par RSA novo. Ele NAO vai para o git.');
