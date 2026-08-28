import { createHmac, randomBytes } from 'node:crypto';

import {
  ACCOUNT_REPOSITORY,
  API_KEY_REPOSITORY,
  AUDIT_REPOSITORY,
  AppModule as ApiModule,
  CONNECTION_LOOKUP,
  CONNECTION_REPOSITORY,
  INBOUND_EVENT_REPOSITORY,
  InProcessEventQueue,
  OUTBOX_REPOSITORY,
} from '@baasconn/api/testing';
import {
  EnvelopeCrypto,
  LocalKmsDriver,
  generateApiKey,
  hashSecret,
  secretLookup,
} from '@baasconn/crypto';
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
  };
  /** Aguarda a fila em processo drenar antes de afirmar sobre o estado. */
  settle(): Promise<void>;
  stop(): Promise<void>;
}

const KMS_SECRET = 'segredo-mestre-do-e2e-com-tamanho-suficiente';
const WEBHOOK_SECRET = 'dev-mock-secret';
const CLIENT_ID = 'mock-client';
const CLIENT_SECRET = 'mock-secret';

export async function startHarness(): Promise<Harness> {
  process.env.NODE_ENV = 'test';
  process.env.KMS_MASTER_SECRET = KMS_SECRET;
  process.env.MOCK_BANK_STORE = 'memory';
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
    },
    // A fila e em processo: drenar e deterministico, sem `sleep`. Um teste que
    // dorme esperando um webhook e um teste que fica intermitente em CI lento.
    settle: () => api.get(InProcessEventQueue).drain(),
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
        'pii:read',
      ],
      secretHash: await hashSecret(generated.secret),
      secretLookup: secretLookup(generated.secret),
      signingRequired: false,
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
      config: {},
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
