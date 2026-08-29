import { randomUUID } from 'node:crypto';

import { systemClock, type Environment } from '@baasconn/taxonomy';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { BullMqEventQueue } from '../../src/queues/bullmq-event-queue.js';
import { createBullConnection } from '../../src/queues/bullmq.tokens.js';
import { QUEUE, jobIdOf, type QueueName } from '../../src/queues/queue.names.js';
import { EmbeddedRedis, hasRedisServer } from '../support/embedded-redis.js';

const ENV = 'HOMOLOGACAO' as Environment;

// Faltar o binario localmente e aceitavel; no CI e build vermelho, senao o job
// passa verde sem ter testado nada.
const disponivel = hasRedisServer();
if (process.env.CI && !disponivel) {
  throw new Error('redis-server ausente no CI: os testes de fila nao rodariam');
}

describe.skipIf(!disponivel)('filas sobre Redis real', () => {
  const server = new EmbeddedRedis();
  let url: string;
  let connection: Redis;
  let prefix: string;
  let queues: Map<QueueName, Queue>;
  let eventQueue: BullMqEventQueue;
  const workers: Worker[] = [];

  beforeAll(async () => {
    url = await server.start();
  }, 30_000);

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    connection = createBullConnection(url);
    // Prefixo unico por teste: no CI o servidor e compartilhado entre arquivos,
    // e `FLUSHALL` apagaria o trabalho de outro.
    prefix = `itest:${randomUUID()}`;
    queues = new Map(
      Object.values(QUEUE).map((name) => [name, new Queue(name, { connection, prefix })]),
    );
    eventQueue = new BullMqEventQueue(queues, systemClock);
  });

  afterEach(async () => {
    await Promise.all(workers.splice(0).map((worker) => worker.close()));
    await Promise.all([...queues.values()].map((queue) => queue.obliterate({ force: true })));
    await Promise.all([...queues.values()].map((queue) => queue.close()));
    connection.disconnect();
  });

  it('a conexao aceita comandos bloqueantes do BullMQ', async () => {
    // `maxRetriesPerRequest: 1` da conexao da API faria o BullMQ recusar em
    // runtime: ele depende de BRPOPLPUSH, que fica pendurado por design.
    const client = createBullConnection(url);
    expect(client.options.maxRetriesPerRequest).toBeNull();
    client.disconnect();
  });

  it('enfileira e o consumidor recebe o payload', async () => {
    const recebidos: string[] = [];

    workers.push(
      new Worker(
        QUEUE.inboundWebhook,
        async (job) => {
          recebidos.push((job.data as { eventId: string }).eventId);
        },
        { connection: createBullConnection(url), prefix },
      ),
    );

    await eventQueue.enqueue({ kind: 'inbound_webhook', eventId: 'evt_1' });
    await eventQueue.drain();

    expect(recebidos).toEqual(['evt_1']);
  });

  it('o mesmo jobId nao entra duas vezes', async () => {
    // A reentrega do provedor, o varredor e o push do caminho quente podem
    // enfileirar o MESMO evento ao mesmo tempo.
    await eventQueue.enqueue({ kind: 'inbound_webhook', eventId: 'evt_dup' });
    await eventQueue.enqueue({ kind: 'inbound_webhook', eventId: 'evt_dup' });

    const fila = queues.get(QUEUE.inboundWebhook)!;
    expect(await fila.getWaitingCount()).toBe(1);
  });

  it('degraus diferentes da mesma operacao sao jobs diferentes', async () => {
    // O degrau entra na chave: reagendar o degrau 3 nao pode ser recusado
    // porque o degrau 2 ja existiu.
    await eventQueue.enqueue({ kind: 'operation_resolve', environment: ENV, operationId: 'opr_1', step: 0 });
    await eventQueue.enqueue({ kind: 'operation_resolve', environment: ENV, operationId: 'opr_1', step: 1 });

    const fila = queues.get(QUEUE.operationResolve)!;
    expect(await fila.getWaitingCount()).toBe(2);
  });

  it('job com atraso nao fica pronto antes da hora', async () => {
    await eventQueue.enqueue({ kind: 'inbound_webhook', eventId: 'evt_atraso' }, { delayMs: 60_000 });

    const fila = queues.get(QUEUE.inboundWebhook)!;
    expect(await fila.getDelayedCount()).toBe(1);
    expect(await fila.getWaitingCount()).toBe(0);
  });

  it('drain conta o job atrasado como pendente', async () => {
    // Um `drain` que ignorasse o delayed set diria "pronto" com a escada
    // inteira ainda por rodar — e o teste seguinte afirmaria sobre um estado
    // que ainda vai mudar.
    await eventQueue.enqueue({ kind: 'inbound_webhook', eventId: 'evt_d' }, { delayMs: 30_000 });
    await expect(eventQueue.drain()).rejects.toThrow(/nao drenaram/);
  }, 20_000);

  it('roteia cada tipo para a sua propria fila', async () => {
    await eventQueue.enqueue({ kind: 'outbox_dispatch', environment: ENV, deliveryId: 'dlv_1' });
    await eventQueue.enqueue({ kind: 'reconciliation', environment: ENV, runId: 'rec_1' });

    // Filas separadas: uma rajada de entrega de webhook nao pode atrasar a
    // conciliacao.
    expect(await queues.get(QUEUE.outboxDispatch)!.getWaitingCount()).toBe(1);
    expect(await queues.get(QUEUE.reconciliation)!.getWaitingCount()).toBe(1);
    expect(await queues.get(QUEUE.inboundWebhook)!.getWaitingCount()).toBe(0);
  });

  it('a chave do job e deterministica', () => {
    // Sem dois-pontos: o BullMQ recusa, porque e o separador das chaves dele.
    expect(jobIdOf({ kind: 'inbound_webhook', eventId: 'evt_1' })).toBe('ibe-evt_1');
    expect(jobIdOf({ kind: 'poll', connectionId: 'con_1', stream: 'statement' })).toBe(
      'poll-con_1-statement-all',
    );
    expect(jobIdOf({ kind: 'inbound_webhook', eventId: 'evt_1' })).not.toContain(':');
  });
});
