import { createHmac, randomBytes } from 'node:crypto';

import {
  ACCOUNT_REPOSITORY,
  API_KEY_REPOSITORY,
  AUDIT_REPOSITORY,
  AppModule as ApiModule,
  CONNECTION_LOOKUP,
  CONNECTION_REPOSITORY,
  INBOUND_EVENT_REPOSITORY,
  EVENT_QUEUE,
  LEDGER_STORE_FACTORY,
  OPERATION_REPOSITORY,
  OUTBOX_REPOSITORY,
  PIX_CHARGE_REPOSITORY,
  PIX_KEY_REPOSITORY,
  TRANSACTION_REPOSITORY,
  buildSignature,
  generateNonce,
  type EventQueue,
} from '@baasconn/api/testing';
import {
  EnvelopeCrypto,
  LocalKmsDriver,
  generateApiKey,
  hashSecret,
  secretLookup,
} from '@baasconn/crypto';
import type { LedgerAccount, LedgerEntry } from '@baasconn/ledger';
import { AppModule as MockBankModule } from '@baasconn/mock-bank/app';
import { Environment, newId } from '@baasconn/taxonomy';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import express from 'express';

/**
 * Sobe API e Mock Bank no MESMO processo, sobre sockets reais.
 *
 * Nao ha Docker neste ambiente e o `compose.yaml` so chega no marco de
 * infraestrutura. In-process nao e concessao: o caminho de rede e real —
 * portas efemeras, `fetch` de verdade, webhook entregue por HTTP do Mock Bank
 * para a API — e o que fica de fora e apenas o SQL, que continua provado a
 * parte por teste de invariante sobre PGlite.
 */
export interface Harness {
  apiUrl: string;
  mockBankUrl: string;
  apiKey: string;
  connectionId: string;
  api: INestApplication;
  mockBank: INestApplication;
  /** Estado gravado, para afirmar sobre outbox, auditoria e eventos. */
  store: {
    outbox: { rows: Array<Record<string, unknown>>; forSubject(id: string): unknown[] };
    audit: { rows: Array<Record<string, unknown>>; forResource(id: string): unknown[] };
    inbound: { rows: Map<string, Record<string, unknown>> };
    accounts: { statusHistory: Array<{ accountId: string; from: string; to: string }> };
    transactions: {
      rows: Map<string, Record<string, unknown>>;
      statusHistory: Array<{ transactionId: string; from: string; to: string }>;
    };
    keys: { rows: Map<string, Record<string, unknown>> };
    charges: { rows: Map<string, Record<string, unknown>> };
    operations: { rows: Map<string, Record<string, unknown>> };
    ledger: {
      for(environment: Environment): {
        snapshot(): { accounts: LedgerAccount[]; entries: LedgerEntry[] };
      };
    };
  };
  /**
   * Assina uma requisicao de movimentacao.
   *
   * As rotas de dinheiro carregam `@RequireSignature()`, entao o e2e PRECISA
   * assinar — e e por isso que o caminho HMAC deixa de ser exercitado so por
   * teste de unidade e passa a ser exercitado de ponta a ponta.
   */
  sign(method: string, path: string, body: unknown): Record<string, string>;
  /** Aguarda a fila em processo drenar antes de afirmar sobre o estado. */
  settle(): Promise<void>;
  /**
   * Espera uma condicao, drenando a fila a cada rodada.
   *
   * A liquidacao do Mock Bank e assincrona por HTTP: o webhook chega quando
   * chega. Isto NAO e um `sleep` de duracao fixa — e um poll sobre a condicao
   * de verdade, com prazo. Um teste que dorme um tempo arbitrario e um teste
   * que fica intermitente em CI lento.
   */
  waitFor(condition: () => boolean | Promise<boolean>, timeoutMs?: number): Promise<void>;
  stop(): Promise<void>;
}

const KMS_SECRET = 'segredo-mestre-do-e2e-com-tamanho-suficiente';
const WEBHOOK_SECRET = 'dev-mock-secret';
const SIGNING_SECRET = 'segredo-de-assinatura-do-e2e';
const CLIENT_ID = 'mock-client';
const CLIENT_SECRET = 'mock-secret';

export async function startHarness(): Promise<Harness> {
  process.env.NODE_ENV = 'test';
  process.env.KMS_MASTER_SECRET = KMS_SECRET;
  process.env.MOCK_BANK_STORE = 'memory';
  // Liquidacao imediata: o atraso aleatorio do Mock Bank serve para demonstrar
  // o produto, nao para tornar a suite lenta e intermitente.
  process.env.MOCK_SETTLEMENT_DELAY_MIN_MS = '0';
  process.env.MOCK_SETTLEMENT_DELAY_MAX_MS = '0';
  process.env.DATABASE_URL ??= 'postgresql://baas:baas@127.0.0.1:5432/baas?schema=public';

  const mockBank = await bootMockBank();
  const mockBankUrl = await mockBank.getUrl();

  const seeded = await seedFixtures(mockBankUrl);
  const api = await bootApi(seeded);
  const apiUrl = await api.getUrl();

  // O Mock Bank precisa saber para onde mandar webhook. Numa instalacao real
  // isto e configurado uma vez no painel do provedor.
  await fetch(`${mockBankUrl}/_control/webhook-url`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      url: `${apiUrl}/webhooks/mock_bank/${seeded.connectionId}`,
    }),
  });

  return {
    apiUrl,
    mockBankUrl,
    apiKey: seeded.apiKey,
    connectionId: seeded.connectionId,
    api,
    mockBank,
    store: {
      outbox: api.get(OUTBOX_REPOSITORY),
      audit: api.get(AUDIT_REPOSITORY),
      inbound: api.get(INBOUND_EVENT_REPOSITORY),
      accounts: api.get(ACCOUNT_REPOSITORY),
      transactions: api.get(TRANSACTION_REPOSITORY),
      keys: api.get(PIX_KEY_REPOSITORY),
      charges: api.get(PIX_CHARGE_REPOSITORY),
      operations: api.get(OPERATION_REPOSITORY),
      ledger: api.get(LEDGER_STORE_FACTORY),
    },
    sign: (method, path, body) => {
      const rawBody = body === undefined ? '' : JSON.stringify(body);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const nonce = generateNonce();
      return {
        'x-baas-timestamp': timestamp,
        'x-baas-nonce': nonce,
        'x-baas-signature': `v1=${buildSignature(SIGNING_SECRET, {
          method,
          path,
          rawBody,
          timestamp,
          nonce,
        })}`,
      };
    },
    // A fila e em processo: drenar e deterministico, sem `sleep`. Um teste que
    // dorme esperando um webhook e um teste que fica intermitente em CI lento.
    settle: () => api.get<EventQueue>(EVENT_QUEUE).drain(),
    waitFor: async (condition, timeoutMs = 5_000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        await api.get<EventQueue>(EVENT_QUEUE).drain();
        if (await condition()) return;
        if (Date.now() > deadline) {
          throw new Error(`Condicao nao satisfeita em ${timeoutMs}ms`);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    },
    stop: async () => {
      await api.close();
      await mockBank.close();
    },
  };
}

async function bootMockBank(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [MockBankModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.listen(0, '127.0.0.1');
  return app;
}

interface Seed {
  apiKey: string;
  apiKeyRecord: Record<string, unknown>;
  connectionId: string;
  connection: Record<string, unknown>;
}

/**
 * Cria a chave de API e a conexao de provedor.
 *
 * As credenciais sao cifradas EM ENVELOPE de verdade, com o mesmo
 * `EnvelopeCrypto` de producao: se o caminho de decifra estivesse quebrado, o
 * e2e falharia — que e o ponto de nao mockar essa parte.
 */
async function seedFixtures(mockBankUrl: string): Promise<Seed> {
  const kms = new LocalKmsDriver(KMS_SECRET);
  const crypto = new EnvelopeCrypto({ kms });
  const connectionId = newId('connection');

  const credentials = await crypto.encryptJson({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
  });
  const webhookSecret = await crypto.encrypt(WEBHOOK_SECRET);

  const keyId = newId('apiKey');
  const generated = generateApiKey({ environment: Environment.HOMOLOGACAO, keyId });

  return {
    apiKey: generated.secret,
    apiKeyRecord: {
      id: keyId,
      name: 'chave do e2e',
      environment: Environment.HOMOLOGACAO,
      scopes: [
        'accounts:read',
        'accounts:write',
        'accounts:close',
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
        'pii:read',
      ],
      secretHash: await hashSecret(generated.secret),
      secretLookup: secretLookup(generated.secret),
      // A chave NAO exige assinatura no registro; quem exige e o
      // `@RequireSignature()` das rotas de dinheiro. E a garantia mais forte
      // das duas: vale mesmo se o registro da chave estiver errado, e e ela
      // que o e2e prova ao mandar uma transferencia sem assinar.
      //
      // Ligar no registro tambem tornaria o upload de documento impossivel: a
      // rota faz stream do corpo, entao `request.rawBody` nunca e preenchido e
      // o guard assina `{}` enquanto o cliente assinou os bytes do arquivo.
      // Fechar essa lacuna pede um digest em streaming, e nao e deste marco.
      signingRequired: false,
      signingSecret: SIGNING_SECRET,
      defaultConnectionId: connectionId,
      ipAllowlist: [],
      rateLimitTier: 'standard',
      status: 'ACTIVE' as const,
      expiresAt: null,
    },
    connectionId,
    connection: {
      id: connectionId,
      environment: Environment.HOMOLOGACAO,
      provider: 'MOCK_BANK',
      status: 'ACTIVE',
      baseUrl: mockBankUrl,
      // Encurta o timeout do adapter: o cenario de desfecho desconhecido do
      // Mock Bank nao responde nunca, e os 10s padrao custariam 10s de suite
      // por teste que o exercita.
      config: { requestTimeoutMs: 1_500 },
      credentials: {
        ciphertext: credentials.ciphertext,
        iv: credentials.iv,
        tag: credentials.authTag,
        wrappedKey: credentials.wrappedKey,
        keyId: credentials.keyId,
        version: credentials.version,
      },
      webhookSecret: {
        ciphertext: webhookSecret.ciphertext,
        iv: webhookSecret.iv,
        tag: webhookSecret.authTag,
        wrappedKey: webhookSecret.wrappedKey,
        keyId: webhookSecret.keyId,
      },
    },
  };
}

async function bootApi(seed: Seed): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [ApiModule] })
    .overrideProvider(API_KEY_REPOSITORY)
    .useValue({
      findByLookup: async (lookup: Buffer) =>
        Buffer.compare(lookup, seed.apiKeyRecord.secretLookup as Buffer) === 0
          ? seed.apiKeyRecord
          : undefined,
      touchLastUsed: async () => undefined,
    })
    .overrideProvider(CONNECTION_REPOSITORY)
    .useValue({
      findById: async (id: string) => (id === seed.connectionId ? seed.connection : undefined),
      // O worker enumera conexoes para agendar conciliacao e polling; sem isto
      // o dobro do harness mentiria sobre o formato da porta.
      listActive: async () => [seed.connection],
    })
    .overrideProvider(CONNECTION_LOOKUP)
    .useValue({
      slugOf: async (id: string) => (id === seed.connectionId ? 'MOCK_BANK' : undefined),
    })
    .compile();

  const app = moduleRef.createNestApplication({ bodyParser: false });

  // Mesma montagem do main.ts: o parser JSON captura os bytes crus para a
  // assinatura HMAC, e as rotas de webhook ficam de fora para o middleware de
  // corpo cru cuidar delas.
  const jsonParser = express.json({
    limit: '1mb',
    verify: (request: express.Request & { rawBody?: Buffer }, _response, buffer) => {
      request.rawBody = Buffer.from(buffer);
    },
  });
  app.use((request: express.Request, response: express.Response, next: express.NextFunction) => {
    if (request.path.startsWith('/webhooks/')) return next();
    if (request.path.includes('/documents')) return next();
    return jsonParser(request, response, next);
  });

  await app.listen(0, '127.0.0.1');
  return app;
}

/**
 * Documentos sinteticos, escolhidos pelo sufixo.
 *
 * O Mock Bank decide o cenario pelos dois ultimos digitos, que num CNPJ sao os
 * digitos VERIFICADORES — nao da para escolher o sufixo e o resto do numero de
 * forma independente. Estes foram gerados procurando CNPJs validos cujo
 * verificador calhe no sufixo desejado, e estao no allowlist do
 * `scripts/check-cassette-pii.ts`.
 */
export const DOCUMENTS = {
  /** Sufixo 81: caminho feliz. */
  cnpjAprova: '11222333000181',
  /** Sufixo 03: screening de sancoes casa e recusa. */
  cnpjSancoes: '10000015000103',
  /** Sufixo 01: pede selfie e comprovante de endereco. */
  cnpjPendencias: '10000008000101',
  /** Sufixo 00: recusa por divergencia com a Receita. */
  cnpjRecusa: '10000017000100',
  cpfAprova: '52998224725',
} as const;

/**
 * Assina um evento como o Mock Bank assinaria.
 *
 * Existe para o teste poder FABRICAR entregas que o Mock Bank nao produz
 * espontaneamente — um evento fora de ordem, por exemplo. Sem isso, o guard
 * monotonico ficaria sem cobertura: o caminho feliz nunca o aciona.
 */
export function signWebhook(body: string, eventId: string, secret = WEBHOOK_SECRET) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return {
    'content-type': 'application/json',
    'x-mockbank-signature': `t=${timestamp},v1=${signature}`,
    'x-mockbank-event-id': eventId,
  };
}

export function uniqueExternalId(): string {
  return `ext-${randomBytes(8).toString('hex')}`;
}
