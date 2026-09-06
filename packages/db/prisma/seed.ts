#!/usr/bin/env tsx
/**
 * Bootstrap de um deployment novo.
 *
 * Sem ele, uma instalacao limpa e INUTILIZAVEL, e a cadeia de bloqueio e
 * fechada:
 *
 *   1. `migrate deploy` cria as tabelas e `console_user` fica vazia.
 *   2. Nao ha rota de cadastro, nem CLI, nem convite — nada insere a primeira
 *      linha, entao `POST /admin/v1/auth/login` sempre responde credencial
 *      invalida.
 *   3. OWNER e ADMIN EXIGEM segundo fator, e nao existe rota de enrolamento de
 *      TOTP. Mesmo um INSERT manual nao resolve: o segredo precisa estar
 *      cifrado com a mesma KMS que a API usa para decifra-lo.
 *   4. Sem sessao ADMIN, `POST /admin/v1/api-keys` e
 *      `POST /admin/v1/connections` sao inalcancaveis.
 *   5. Sem API key e sem conexao, a API canonica `/v1` nao tem como ser usada.
 *
 * Este script quebra o ciclo no ponto 3: cifra o segredo TOTP com a MESMA
 * `EnvelopeCrypto` da aplicacao, entao o login funciona de verdade — sem
 * enfraquecer a regra de MFA nem inventar um caminho paralelo de
 * autenticacao.
 *
 * IDEMPOTENTE: rodar duas vezes nao duplica nada e nao troca a senha de um
 * usuario que ja existe. Rodar de novo depois de mexer no ambiente e uma
 * operacao segura, que e o que se espera de um comando que a documentacao
 * manda rodar.
 */
import {
  EnvelopeCrypto,
  LocalKmsDriver,
  encodeBase32,
  generateApiKey,
  hashSecret,
  secretLookup,
  totpCode,
} from '@baasconn/crypto';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';

import { newId } from '@baasconn/taxonomy';

/**
 * `Buffer` -> `Uint8Array<ArrayBuffer>`.
 *
 * Os campos `Bytes` do Prisma pedem `Uint8Array<ArrayBuffer>`, e o `Buffer`
 * do Node e `Uint8Array<ArrayBufferLike>` — que pode ser um
 * `SharedArrayBuffer` e por isso nao satisfaz o tipo. Os repositorios da API
 * ja fazem a mesma conversao; este arquivo escreve no Prisma direto.
 */
const bytes = (b: Buffer | Uint8Array): Uint8Array<ArrayBuffer> =>
  new Uint8Array(b) as Uint8Array<ArrayBuffer>;

const EMAIL = process.env.SEED_EMAIL ?? 'admin@local.test';
const SENHA = process.env.SEED_PASSWORD ?? 'baas-connector-demo';
const MOCK_BANK_URL = process.env.SEED_MOCK_BANK_URL ?? 'http://mock-bank:3002';

/**
 * Segundo usuario, SEM segundo fator, para testar sem autenticador.
 *
 * DESLIGADO por padrao, e a razao nao e cerimonia: o padrao aqui e
 * `admin@admin.com` / `admin`, que e o par de credenciais mais varrido por
 * bot que existe. Num ambiente alcancavel da internet, liga-lo por descuido
 * entrega o console.
 *
 * Ele nasce OPERATOR, e nao ADMIN, porque `MFA_REQUIRED_ROLES` exige segundo
 * fator de OWNER e ADMIN por regra de PAPEL — a flag `mfaEnabled` nao
 * desliga isso. Um login sem 2FA so existe abaixo desse nivel, e essa e
 * exatamente a protecao de quem pode gravar credencial de provedor e cunhar
 * API key. OPERATOR alcanca todo o fluxo de teste: contas, transacoes,
 * extrato, razao, conciliacao em leitura e a tela do Mock Bank.
 */
const OPERADOR_ATIVO = process.env.SEED_DEV_OPERATOR === 'true';
const OPERADOR_EMAIL = process.env.SEED_DEV_OPERATOR_EMAIL ?? 'admin@admin.com';
const OPERADOR_SENHA = process.env.SEED_DEV_OPERATOR_PASSWORD ?? 'admin';

/** Os escopos que o fluxo dourado exercita. Nada alem. */
const ESCOPOS = [
  'accounts:read',
  'accounts:write',
  'onboarding:read',
  'onboarding:write',
  'onboarding:documents',
  'balance:read',
  'pix:read',
  'pix:write',
  'pix:refund',
  'pix:keys:read',
  'pix:keys:write',
  'statement:read',
] as const;

const prisma = new PrismaClient();

function exigir(nome: string): string {
  const valor = process.env[nome];
  if (!valor) {
    console.error(`\nFalta ${nome}. Rode \`pnpm dev:env\` ou copie .env.example para .env.\n`);
    process.exit(1);
  }
  return valor;
}

async function main(): Promise<void> {
  const kms = new LocalKmsDriver(exigir('KMS_MASTER_SECRET'));
  const crypto = new EnvelopeCrypto({ kms });

  const linhas: string[] = [];

  // ---------------------------------------------------------------- usuario
  let usuario = await prisma.consoleUser.findUnique({ where: { email: EMAIL } });
  let segredoTotp: Buffer | undefined;

  if (usuario) {
    linhas.push(`Usuario ${EMAIL} ja existe — senha e TOTP preservados.`);
  } else {
    // 20 bytes: o tamanho que o RFC 4226 recomenda para HMAC-SHA1, e o que
    // Google Authenticator, Authy e 1Password esperam.
    segredoTotp = randomBytes(20);
    const envelope = await crypto.encrypt(segredoTotp);

    usuario = await prisma.consoleUser.create({
      data: {
        id: newId('user'),
        email: EMAIL,
        name: 'Administrador local',
        passwordHash: await hashSecret(SENHA),
        // OWNER para o teste alcancar TODAS as telas. OWNER e ADMIN exigem
        // MFA — e por isso que o segredo acima e cifrado aqui, e nao deixado
        // para um enrolamento que nao existe.
        role: 'OWNER',
        totpSecretCiphertext: bytes(envelope.ciphertext),
        totpSecretIv: bytes(envelope.iv),
        totpSecretTag: bytes(envelope.authTag),
        totpSecretWrappedKey: bytes(envelope.wrappedKey),
        totpSecretKeyId: envelope.keyId,
        mfaEnabled: true,
        status: 'ACTIVE',
      },
    });
    linhas.push(`Usuario ${EMAIL} criado (OWNER).`);
  }

  // ------------------------------------------------------- operador sem 2FA
  if (OPERADOR_ATIVO) {
    const hash = await hashSecret(OPERADOR_SENHA);
    const dados = {
      passwordHash: hash,
      role: 'OPERATOR' as const,
      mfaEnabled: false,
      status: 'ACTIVE',
    };

    // `upsert` e nao o ramo "preserva se existe" do usuario OWNER acima: la a
    // senha e do operador e sobrescreve-la seria perder acesso; aqui a senha
    // vem de variavel de ambiente, entao reexecutar o seed depois de trocar
    // SEED_DEV_OPERATOR_PASSWORD tem que aplicar a troca.
    await prisma.consoleUser.upsert({
      where: { email: OPERADOR_EMAIL },
      update: dados,
      create: {
        id: newId('user'),
        email: OPERADOR_EMAIL,
        name: 'Operador de teste',
        ...dados,
      },
    });
    linhas.push(`Usuario ${OPERADOR_EMAIL} criado/atualizado (OPERATOR, sem 2FA).`);
  }

  // ---------------------------------------------------------------- conexao
  const conexaoExistente = await prisma.providerConnection.findUnique({
    where: {
      environment_provider_label: {
        environment: 'HOMOLOGACAO',
        provider: 'MOCK_BANK',
        label: 'default',
      },
    },
  });

  let conexaoId: string;
  if (conexaoExistente) {
    conexaoId = conexaoExistente.id;
    linhas.push('Conexao MOCK_BANK/HOMOLOGACAO ja existe.');
  } else {
    // As mesmas credenciais que o Mock Bank aceita por padrao. Ele e um banco
    // FALSO: nao ha segredo real aqui, e inventar um so tornaria o primeiro
    // teste mais dificil sem tornar nada mais seguro.
    const credenciais = { clientId: 'mock-client', clientSecret: 'mock-secret' };
    const envelope = await crypto.encryptJson(credenciais);
    const webhook = await crypto.encrypt('dev-mock-secret');

    conexaoId = newId('connection');
    await prisma.providerConnection.create({
      data: {
        id: conexaoId,
        environment: 'HOMOLOGACAO',
        provider: 'MOCK_BANK',
        label: 'default',
        status: 'ACTIVE',
        baseUrl: MOCK_BANK_URL,
        credentialsCiphertext: bytes(envelope.ciphertext),
        credentialsIv: bytes(envelope.iv),
        credentialsTag: bytes(envelope.authTag),
        credentialsWrappedKey: bytes(envelope.wrappedKey),
        credentialsKeyId: envelope.keyId,
        credentialsFingerprint: 'sha256:seed',
        credentialsLast4: 'ient',
        credentialsUpdatedAt: new Date(),
        credentialsUpdatedBy: usuario.id,
        webhookSecretCiphertext: bytes(webhook.ciphertext),
        webhookSecretIv: bytes(webhook.iv),
        webhookSecretTag: bytes(webhook.authTag),
        webhookSecretWrappedKey: bytes(webhook.wrappedKey),
        webhookSecretKeyId: webhook.keyId,
        config: {},
      },
    });
    linhas.push('Conexao MOCK_BANK/HOMOLOGACAO criada.');
  }

  // ---------------------------------------------------------------- api key
  const chaveExistente = await prisma.apiKey.findFirst({
    where: { name: 'demo', environment: 'HOMOLOGACAO', status: 'ACTIVE' },
  });

  let segredoChave: string | undefined;
  if (chaveExistente) {
    linhas.push('API key `demo` ja existe — o segredo NAO pode ser recuperado.');
  } else {
    const id = newId('apiKey');
    const gerada = generateApiKey({ environment: 'HOMOLOGACAO', keyId: id });
    segredoChave = gerada.secret;

    await prisma.apiKey.create({
      data: {
        id,
        environment: 'HOMOLOGACAO',
        name: 'demo',
        prefix: gerada.prefix,
        last4: gerada.last4,
        secretHash: await hashSecret(gerada.secret),
        secretLookup: bytes(secretLookup(gerada.secret)),
        scopes: [...ESCOPOS],
        // Sem assinatura HMAC: e uma chave de HOMOLOGACAO, e exigir
        // assinatura no primeiro `curl` faria o primeiro teste falhar por
        // um motivo que nao tem nada a ver com o que se quer testar. Em
        // PRODUCAO com `pix:write` a API FORCA a assinatura, e essa regra
        // continua valendo.
        signingRequired: false,
        defaultConnectionId: conexaoId,
        createdBy: usuario.id,
      },
    });
    linhas.push('API key `demo` criada.');
  }

  // ---------------------------------------------------------------- relatorio
  console.warn(`\n${'='.repeat(66)}`);
  for (const linha of linhas) console.warn(`  ${linha}`);
  console.warn('='.repeat(66));

  console.warn(`\n  CONSOLE   http://localhost:3000`);
  console.warn(`  e-mail    ${EMAIL}`);
  console.warn(`  senha     ${SENHA}`);

  if (OPERADOR_ATIVO) {
    console.warn(`\n  Ou, SEM segundo fator (OPERATOR):`);
    console.warn(`  e-mail    ${OPERADOR_EMAIL}`);
    console.warn(`  senha     ${OPERADOR_SENHA}`);
    console.warn(
      `\n  Este usuario NAO cria conexao de provedor nem cunha API key —\n` +
        `  para isso entre com ${EMAIL}.`,
    );
    console.warn(
      `  Se este ambiente for alcancavel da internet, desligue-o:\n` + `  SEED_DEV_OPERATOR=false`,
    );
  }

  if (segredoTotp) {
    const base32 = encodeBase32(segredoTotp);
    console.warn(`\n  O console pede um codigo de 6 digitos (OWNER exige 2FA).`);
    console.warn(`  Adicione este segredo ao seu autenticador:\n`);
    console.warn(`    ${base32}`);
    console.warn(`\n  Ou escaneie:`);
    console.warn(
      `    otpauth://totp/BaaS%20Connector:${encodeURIComponent(EMAIL)}?secret=${base32}&issuer=BaaS%20Connector`,
    );
    console.warn(
      `\n  Codigo valido AGORA (expira em ate 30s):  ${totpCode(segredoTotp, new Date())}`,
    );
  }

  if (segredoChave) {
    console.warn(`\n  API KEY (aparece uma unica vez):\n`);
    console.warn(`    ${segredoChave}`);
  }

  console.warn(`\n${'='.repeat(66)}\n`);
}

main()
  .catch((erro: unknown) => {
    console.error(erro);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
