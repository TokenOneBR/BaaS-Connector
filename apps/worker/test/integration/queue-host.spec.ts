import { randomUUID } from 'node:crypto';

import {
  EnvelopeCrypto,
  type ClaimedOutboxEvent,
  type WebhookEndpointRecord,
} from '@baasconn/api/domain';
import {
  MemoryOutboxDispatchRepository,
  MemoryWebhookDeliveryRepository,
  MemoryWebhookEndpointRepository,
} from '@baasconn/api/testing';
import { LocalKmsDriver } from '@baasconn/crypto';
import { Metrics } from '@baasconn/observability';
import { Environment, EventType, FixedClock, newId, systemClock } from '@baasconn/taxonomy';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { SweepersService } from '../../src/maintenance/sweepers.service.js';
import { EndpointSecrets } from '../../src/outbox/endpoint-secrets.js';
import { OutboxDispatcherService } from '../../src/outbox/outbox-dispatcher.service.js';
import { OutboxHandler } from '../../src/outbox/outbox.handler.js';
import { WebhookTransport } from '../../src/outbox/webhook-transport.js';
import { BullMqEventQueue } from '../../src/queues/bullmq-event-queue.js';
import { createBullConnection } from '../../src/queues/bullmq.tokens.js';
import { QueueHandlerRegistry } from '../../src/queues/handler.registry.js';
import { JobRunner } from '../../src/queues/job-runner.js';
import { QUEUE, type QueueName } from '../../src/queues/queue.names.js';
import { QueueHost } from '../../src/queues/queue.host.js';
import { EmbeddedRedis, hasRedisServer } from '../support/embedded-redis.js';
import { EndpointServer } from '../support/endpoint-server.js';

const ENV = Environment.HOMOLOGACAO;
const MASTER = 'chave-mestra-local-de-teste-com-tamanho';

const disponivel = hasRedisServer();
if (process.env.CI && !disponivel) {
  throw new Error('redis-server ausente no CI: o host de processadores nao seria testado');
}

/**
 * A cadeia inteira, sem ninguem puxando o gatilho.
 *
 * Os testes do commit anterior chamavam `claimAndFanOut()` e `deliver()` a
 * mao. Este arquivo existe porque isso NAO provava o que importa: em producao
 * ninguem chama. Aqui o varredor reivindica, o `BullMqEventQueue` enfileira no
 * Redis de verdade, o `Worker` do host consome, e o endpoint HTTP recebe — e
 * cada elo que faltar deixa `server.received` vazio.
 */
describe.skipIf(!disponivel)('host de processadores sobre Redis real', () => {
  const redis = new EmbeddedRedis();
  let redisUrl: string;

  let server: EndpointServer;
  let url: string;
  let connection: Redis;
  let prefix: string;
  let queues: Map<QueueName, Queue>;
  let clock: FixedClock;

  let outbox: MemoryOutboxDispatchRepository;
  let endpoints: MemoryWebhookEndpointRepository;
  let deliveries: MemoryWebhookDeliveryRepository;
  let dispatcher: OutboxDispatcherService;
  let registry: QueueHandlerRegistry;
  let host: QueueHost;
  let sweepers: SweepersService;
  let eventQueue: BullMqEventQueue;
  let endpoint: WebhookEndpointRecord;

  beforeAll(async () => {
    redisUrl = await redis.start();
  }, 30_000);

  afterAll(async () => {
    await redis.stop();
  });

  beforeEach(async () => {
    server = new EndpointServer();
    url = await server.start();
    clock = new FixedClock(new Date('2026-08-29T12:00:00.000Z'));

    connection = createBullConnection(redisUrl);
    // Prefixo unico por teste: no CI o servidor e compartilhado entre
    // arquivos, e o `obliterate` do teardown apagaria o trabalho de outro.
    prefix = `itest:${randomUUID()}`;
    queues = new Map(
      Object.values(QUEUE).map((name) => [name, new Queue(name, { connection, prefix })]),
    );

    outbox = new MemoryOutboxDispatchRepository();
    endpoints = new MemoryWebhookEndpointRepository();
    deliveries = new MemoryWebhookDeliveryRepository();
    eventQueue = new BullMqEventQueue(queues, systemClock);

    const crypto = new EnvelopeCrypto({ kms: new LocalKmsDriver(MASTER) });
    const envelope = await crypto.encrypt('whsec_do_endpoint');
    endpoint = {
      id: newId('webhookEndpoint'),
      environment: ENV,
      url,
      eventTypes: [],
      secret: {
        ciphertext: envelope.ciphertext,
        iv: envelope.iv,
        authTag: envelope.authTag,
        wrappedKey: envelope.wrappedKey,
        keyId: envelope.keyId,
        version: envelope.version,
      },
      previousSecret: null,
      previousSecretExpiresAt: null,
      status: 'ACTIVE',
      consecutiveFailures: 0,
      updatedAt: clock.now(),
    };
    endpoints.rows.set(endpoint.id, endpoint);

    dispatcher = new OutboxDispatcherService(
      new WebhookTransport(),
      new EndpointSecrets(crypto, clock),
      new Metrics(),
      outbox,
      endpoints,
      deliveries,
      eventQueue,
      clock,
    );

    registry = new QueueHandlerRegistry();
    new OutboxHandler(dispatcher, registry, deliveries, outbox).onModuleInit();

    const naoEhTeste = { isTest: false } as never;
    host = new QueueHost(
      naoEhTeste,
      registry,
      new JobRunner(new Metrics(), clock),
      connection,
      prefix,
    );
    sweepers = new SweepersService(
      naoEhTeste,
      dispatcher,
      new Metrics(),
      eventQueue,
      // A escada nao participa deste teste: o varredor dela e independente do
      // de entregas, e um dobro vazio mantem o cenario no que se quer provar.
      { sweepStuck: async () => 0 } as never,
      deliveries,
      eventQueue,
      clock,
    );
  });

  afterEach(async () => {
    await host.onApplicationShutdown();
    await Promise.all([...queues.values()].map((queue) => queue.obliterate({ force: true })));
    await Promise.all([...queues.values()].map((queue) => queue.close()));
    connection.disconnect();
    await server.stop();
  });

  function semear(overrides: Partial<ClaimedOutboxEvent> = {}): ClaimedOutboxEvent {
    const event: ClaimedOutboxEvent = {
      id: newId('event'),
      environment: ENV,
      type: EventType.PIX_OUT_SETTLED,
      dataVersion: 1,
      provider: 'MOCK_BANK',
      connectionId: 'con_1',
      subjectKind: 'transaction',
      subjectId: 'txn_1',
      sequence: 1n,
      payload: { status: 'SETTLED', amount_cents: '15000' },
      occurredAt: clock.now(),
      createdAt: clock.now(),
      ...overrides,
    };
    outbox.rows.set(event.id, { ...event });
    deliveries.sequenceOf.set(event.id, event.sequence);
    deliveries.subjectOf.set(event.id, { kind: event.subjectKind, id: event.subjectId });
    deliveries.environmentOf.set(event.id, event.environment);
    return event;
  }

  /** Espera a condicao, sem `sleep` fixo, que e como teste vira intermitente. */
  async function aguardar(condicao: () => boolean, prazoMs = 10_000): Promise<void> {
    const limite = Date.now() + prazoMs;
    while (!condicao()) {
      if (Date.now() > limite) throw new Error('Condicao nao ocorreu no prazo');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  it('o varredor reivindica, o host consome e o endpoint recebe — sem chamada manual', async () => {
    const event = semear();
    host.onApplicationBootstrap();

    await sweepers.sweepOutbox();
    await aguardar(() => server.received.length > 0);

    expect(server.received).toHaveLength(1);
    expect(JSON.parse(server.received[0]!.body)).toMatchObject({ id: event.id });
  });

  it('a entrega vencida volta pelo varredor, e nao pelo caminho quente', async () => {
    // Simula o pod que morreu entre gravar a linha e enfileirar: a linha
    // existe, o job nunca existiu. Sem o varredor, ficaria parada para sempre.
    const event = semear();
    await deliveries.scheduleFirstAttempts([
      {
        id: newId('delivery'),
        eventId: event.id,
        endpointId: endpoint.id,
        scheduledFor: clock.now(),
      },
    ]);
    host.onApplicationBootstrap();

    const reenfileiradas = await sweepers.sweepDeliveries();
    expect(reenfileiradas).toBe(1);

    await aguardar(() => server.received.length > 0);
    expect(server.received).toHaveLength(1);
  });

  it('o varredor enfileira com o ambiente do evento, nunca um inventado', async () => {
    const event = semear({ environment: Environment.PRODUCAO });
    await deliveries.scheduleFirstAttempts([
      {
        id: newId('delivery'),
        eventId: event.id,
        endpointId: endpoint.id,
        scheduledFor: clock.now(),
      },
    ]);

    const vencidas = await deliveries.claimDue(10, clock.now());
    expect(vencidas[0]?.environment).toBe(Environment.PRODUCAO);
  });

  it('o mesmo evento nao sai duas vezes quando dois varredores correm', async () => {
    semear();
    host.onApplicationBootstrap();

    // `dispatchedAt` e gravado na reivindicacao: a segunda varredura nao acha
    // nada, e o `jobId` deduplicaria mesmo se achasse.
    const primeira = await sweepers.sweepOutbox();
    const segunda = await sweepers.sweepOutbox();
    expect(primeira).toBe(1);
    expect(segunda).toBe(0);

    await aguardar(() => server.received.length > 0);
    await eventQueue.drain();
    expect(server.received).toHaveLength(1);
  });

  it('fila sem processador registrado nao ganha consumidor', () => {
    host.onApplicationBootstrap();
    // So `outbox_dispatch` esta registrado. Um `Worker` na fila de conciliacao
    // pegaria o job e o mataria com "sem processador" — pior do que deixa-lo
    // esperando visivelmente ate o processador existir.
    expect(registry.kinds).toEqual(['outbox_dispatch']);
  });

  it('em teste o host fica parado, mesmo com processador registrado', async () => {
    // O guarda existe para um consumidor de fundo nao competir com o cenario
    // que o teste esta montando. Se ele parasse de valer, todo teste de
    // unidade da suite passaria a ter um Worker consumindo por baixo.
    const emTeste = new QueueHost(
      { isTest: true } as never,
      registry,
      new JobRunner(new Metrics(), clock),
      connection,
      prefix,
    );
    emTeste.onApplicationBootstrap();
    semear();
    await sweepers.sweepOutbox();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(server.received).toHaveLength(0);
    await emTeste.onApplicationShutdown();
  });

  it('recusa dois processadores para o mesmo tipo', () => {
    expect(() => registry.register('outbox_dispatch', async () => undefined)).toThrow(
      /Ja existe processador/,
    );
  });

  it('o job carrega as tentativas da politica da fila', async () => {
    await eventQueue.enqueue({ kind: 'inbound_webhook', eventId: 'ibe_1' });
    const [job] = await queues.get(QUEUE.inboundWebhook)!.getJobs(['waiting']);
    // Sem isto o `QUEUE_POLICY` seria decorativo e todo job cairia em 1.
    expect(job?.opts.attempts).toBe(3);
    expect(job?.opts.backoff).toMatchObject({ type: 'exponential', delay: 1_000 });
  });
});
