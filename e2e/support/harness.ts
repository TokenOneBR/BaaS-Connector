import { createHmac, randomBytes } from 'node:crypto';

import { mockbankManifest } from '@baasconn/adapter-mock-bank';
import {
  ACCOUNT_REPOSITORY,
  API_KEY_REPOSITORY,
  AUDIT_REPOSITORY,
  AppModule as ApiModule,
  BreakResolutionService,
  CLOCK,
  CONNECTION_LOOKUP,
  CONNECTION_REPOSITORY,
  CONSOLE_SESSION_REPOSITORY,
  CONSOLE_USER_REPOSITORY,
  MemoryConnectionRepository,
  MemoryConsoleSessionRepository,
  MemoryConsoleUserRepository,
  INBOUND_EVENT_REPOSITORY,
  EVENT_QUEUE,
  LEDGER_STORE_FACTORY,
  OPERATION_REPOSITORY,
  OUTBOX_REPOSITORY,
  PIX_CHARGE_REPOSITORY,
  PIX_KEY_REPOSITORY,
  ProviderResolver,
  RECONCILIATION_BREAK_REPOSITORY,
  RECONCILIATION_RUN_REPOSITORY,
  ShadowLedgerService,
  TRANSACTION_REPOSITORY,
  WebhookApplyService,
  buildSignature,
  generateNonce,
  type EventQueue,
  type ReconciliationBreakRepository,
  type ReconciliationRunRepository,
  type StoredConnection,
} from '@baasconn/api/testing';
import {
  EnvelopeCrypto,
  LocalKmsDriver,
  generateApiKey,
  encodeBase32,
  hashSecret,
  secretLookup,
} from '@baasconn/crypto';
import type { LedgerAccount, LedgerEntry } from '@baasconn/ledger';
import { AppModule as MockBankModule } from '@baasconn/mock-bank/app';
import { Metrics } from '@baasconn/observability';
import { ConsoleRole, Environment, FixedClock, newId } from '@baasconn/taxonomy';
import { AutoResolutionService, ReconciliationService } from '@baasconn/worker/testing';
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
  /**
   * Segredo de assinatura HMAC da chave semeada.
   *
   * As rotas de dinheiro carregam `@RequireSignature()`, entao sem ele um
   * cliente recebe 401 na primeira transferencia. O SDK assina sozinho; quem
   * usa `curl` precisa deste valor.
   */
  signingSecret: string;
  /**
   * Segredo TOTP em bytes, presente so quando o papel semeado exige MFA.
   *
   * Quem sobe o harness para um HUMANO usar (o modo demo) precisa dele para
   * imprimir o codigo; os specs, que entram por API key, nunca o usam.
   */
  consoleTotpSecret?: Buffer;
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
    reconciliationRuns: ReconciliationRunRepository;
    reconciliationBreaks: ReconciliationBreakRepository;
  };
  /**
   * Conciliacao, montada a mao.
   *
   * Os servicos moram em `apps/worker` e sao construidos aqui com os MESMOS
   * dobros que a API ja usa — nao com dobros proprios. O que se prova e o
   * FLUXO (quebra semeada -> quebra aberta -> ajuste lancado), nao a fiacao: o
   * grafo de DI do worker tem teste proprio e o BullMQ tem o dele contra Redis
   * de verdade.
   */
  reconcile(input: {
    accountId: string;
    windowStart: Date;
    windowEnd: Date;
    scope?: 'DAILY' | 'INTRADAY' | 'MANUAL';
    /**
     * Instante em que a conciliacao se ve rodando. Padrao: agora.
     *
     * Existe porque a graca de liquidacao e por IDADE DO ITEM: um movimento
     * nosso de tres minutos atras legitimamente ainda nao esta no extrato do
     * provedor, entao `MISSING_ON_PROVIDER` fica suprimido. Adiantar o relogio
     * e como a `recon.daily` das 03:00 enxerga a janela de ontem — e a unica
     * forma de exercitar a quebra sem dormir duas horas.
     */
    asOf?: Date;
  }): Promise<string>;
  /** Resolucao manual, pelo servico de producao. */
  resolveBreak: BreakResolutionService;
  /** Metricas da API. `baas_ledger_imbalance_detected_total` fica em zero. */
  metrics: Metrics;
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

export interface HarnessOptions {
  /**
   * Janela da regra 3 de bypass do cache de saldo.
   *
   * Zero desliga a regra. Um spec que quer afirmar sobre a regra 5 precisa
   * disso: a 3 e avaliada antes e venceria sempre, porque todo cenario de
   * conciliacao comeca com um movimento recente.
   */
  postMutationBypassSeconds?: number;
  /**
   * Semeia um usuario de console, para o `/admin/v1` ser alcancavel.
   *
   * Os specs de API nao precisam: eles entram por API key. O Playwright do
   * console precisa, porque o BFF comeca pelo login. Fica opcional para o
   * caminho comum nao pagar por um hash Argon2id que ele nao usa.
   */
  consoleUser?: { email: string; password: string; role: ConsoleRole };
  /**
   * Portas fixas em vez de efemeras.
   *
   * Os specs de Vitest usam efemera, que e o certo: nao colidem entre si e
   * nao dependem de nada estar livre. O Playwright precisa do oposto — ele
   * inicia o servidor como PROCESSO e espera uma porta anunciada na config,
   * e nao ha como ele descobrir uma porta escolhida depois.
   */
  ports?: { api: number; mockBank: number };
}

export async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  process.env.NODE_ENV = 'test';
  if (options.postMutationBypassSeconds !== undefined) {
    process.env.POST_MUTATION_BYPASS = String(options.postMutationBypassSeconds);
  }
  process.env.KMS_MASTER_SECRET = KMS_SECRET;
  process.env.MOCK_BANK_STORE = 'memory';
  // Liquidacao imediata: o atraso aleatorio do Mock Bank serve para demonstrar
  // o produto, nao para tornar a suite lenta e intermitente.
  process.env.MOCK_SETTLEMENT_DELAY_MIN_MS = '0';
  process.env.MOCK_SETTLEMENT_DELAY_MAX_MS = '0';
  process.env.DATABASE_URL ??= 'postgresql://baas:baas@127.0.0.1:5432/baas?schema=public';

  const mockBank = await bootMockBank(options.ports?.mockBank);
  const mockBankUrl = await mockBank.getUrl();

  const seeded = await seedFixtures(mockBankUrl);
  const api = await bootApi(seeded, options);
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
    signingSecret: SIGNING_SECRET,
    consoleTotpSecret: totpDoConsole,
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
      reconciliationRuns: api.get(RECONCILIATION_RUN_REPOSITORY),
      reconciliationBreaks: api.get(RECONCILIATION_BREAK_REPOSITORY),
    },
    reconcile: async ({ accountId, windowStart, windowEnd, scope = 'MANUAL', asOf }) => {
      const runs = api.get<ReconciliationRunRepository>(RECONCILIATION_RUN_REPOSITORY);
      const { run } = await runs.startRun({
        id: newId('reconciliationRun'),
        environment: Environment.HOMOLOGACAO,
        connectionId: seeded.connectionId,
        // NUNCA nulo: em Postgres NULL nao e igual a NULL num indice unico,
        // entao um run de conexao inteira escaparia da deduplicacao.
        accountId,
        scope: scope as never,
        windowStart,
        windowEnd,
        triggeredBy: 'e2e',
      });
      await buildReconciliation(api, asOf).run(Environment.HOMOLOGACAO, run.id);
      return run.id;
    },
    resolveBreak: api.get(BreakResolutionService),
    metrics: api.get(Metrics),
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

/**
 * Monta o `ReconciliationService` do worker sobre os objetos vivos da API.
 *
 * Construcao posicional em vez de container: os tokens de `@baasconn/api/domain`
 * (dist) e os de `@baasconn/api/testing` (src) sao `Symbol()` distintos, entao
 * um `Test.createTestingModule` do worker nao encontraria nada do app que ja
 * esta de pe. `new` nao consulta token nenhum — e o que faz as duas seams
 * conviverem sem uma segunda copia do estado.
 */
function buildReconciliation(api: INestApplication, asOf?: Date): ReconciliationService {
  const autoResolution = new AutoResolutionService(
    api.get(WebhookApplyService) as never,
    api.get(TRANSACTION_REPOSITORY),
    api.get(OUTBOX_REPOSITORY),
    api.get(AUDIT_REPOSITORY),
    api.get(CLOCK),
  );

  return new ReconciliationService(
    api.get(ProviderResolver) as never,
    api.get(ShadowLedgerService) as never,
    autoResolution,
    api.get(Metrics),
    api.get(RECONCILIATION_RUN_REPOSITORY),
    api.get(RECONCILIATION_BREAK_REPOSITORY),
    api.get(ACCOUNT_REPOSITORY),
    api.get(TRANSACTION_REPOSITORY),
    api.get(OUTBOX_REPOSITORY),
    asOf ? new FixedClock(asOf) : api.get(CLOCK),
  );
}

async function bootMockBank(port = 0): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [MockBankModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.listen(port, '127.0.0.1');
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

/**
 * Semeia a conexao do Mock Bank no dobro, com envelope e resumo.
 *
 * Escreve direto em `rows` em vez de chamar `create()`: `create()` cifraria de
 * novo, e o envelope precisa ser exatamente o que o `CredentialResolver` vai
 * decifrar com a chave mestra deste harness.
 */
function seedConnection(repo: MemoryConnectionRepository, seed: Seed): MemoryConnectionRepository {
  const conexao = seed.connection as unknown as StoredConnection;
  repo.rows.set(seed.connectionId, {
    ...conexao,
    summary: {
      id: seed.connectionId,
      environment: conexao.environment,
      provider: conexao.provider,
      label: 'mock-bank',
      status: 'ACTIVE',
      baseUrl: conexao.baseUrl,
      config: conexao.config,
      // O manifesto REAL do adapter, e nao um mapa vazio: a aba de
      // capacidades do console o renderiza, e um dobro que devolvesse vazio
      // faria a tela parecer certa mostrando "nada suportado".
      capabilities: mockbankManifest as unknown as Record<string, unknown>,
      credentials: {
        set: true,
        fingerprint: 'sha256:e2e',
        last4: 'ient',
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
      webhookSecretSet: true,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    },
  });
  return repo;
}

/**
 * Segredo TOTP do usuario de console semeado, quando o papel exige MFA.
 *
 * `OWNER` e `ADMIN` estao em `MFA_REQUIRED_ROLES` INCONDICIONALMENTE, entao
 * semear um deles sem TOTP produz um usuario que nao consegue entrar: o login
 * recusa com "verificacao em duas etapas ainda nao configurada". Nao ha rota
 * de enrolamento, entao o segredo precisa nascer aqui.
 *
 * `OPERATOR` e papeis abaixo continuam sem TOTP — e o que o Playwright usa, e
 * o que mantem o spec de login simples.
 */
let totpDoConsole: Buffer | undefined;

async function bootApi(seed: Seed, options: HarnessOptions): Promise<INestApplication> {
  const users = new MemoryConsoleUserRepository();
  totpDoConsole = undefined;

  if (options.consoleUser) {
    const exigeMfa =
      options.consoleUser.role === ConsoleRole.OWNER ||
      options.consoleUser.role === ConsoleRole.ADMIN;
    // 20 bytes: o tamanho que o RFC 4226 recomenda para HMAC-SHA1, e o que
    // Google Authenticator, Authy e 1Password esperam.
    if (exigeMfa) totpDoConsole = randomBytes(20);

    users.seed({
      id: newId('user'),
      email: options.consoleUser.email,
      name: options.consoleUser.email,
      passwordHash: await hashSecret(options.consoleUser.password),
      role: options.consoleUser.role,
      mfaEnabled: exigeMfa,
      totpSecret: totpDoConsole ? encodeBase32(totpDoConsole) : undefined,
      status: 'ACTIVE',
    });
  }

  const moduleRef = await Test.createTestingModule({ imports: [ApiModule] })
    .overrideProvider(CONSOLE_USER_REPOSITORY)
    .useValue(users)
    .overrideProvider(CONSOLE_SESSION_REPOSITORY)
    .useValue(new MemoryConsoleSessionRepository())
    .overrideProvider(API_KEY_REPOSITORY)
    .useValue({
      findByLookup: async (lookup: Buffer) =>
        Buffer.compare(lookup, seed.apiKeyRecord.secretLookup as Buffer) === 0
          ? seed.apiKeyRecord
          : undefined,
      touchLastUsed: async () => undefined,
    })
    .overrideProvider(CONNECTION_REPOSITORY)
    // O dobro REAL, e nao um objeto literal com dois metodos.
    //
    // O literal anterior implementava `findById` e `listActive` e mais nada, e
    // ficou verde enquanto so os specs de API entravam por API key. O console
    // chama `listSummaries`, e a ausencia virava 500 numa tela — descoberto
    // pelo Playwright, que e exatamente o que ele existe para pegar. Um dobro
    // que implementa MENOS que a porta e uma mentira sobre a porta.
    .useValue(seedConnection(new MemoryConnectionRepository(), seed))
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

  await app.listen(options.ports?.api ?? 0, '127.0.0.1');
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
