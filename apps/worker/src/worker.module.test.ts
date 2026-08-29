import { ApiConfig, Metrics, PrismaService, WebhookApplyService } from '@baasconn/api/domain';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SweepersService } from './maintenance/sweepers.service.js';
import { BullMqEventQueue } from './queues/bullmq-event-queue.js';
import { QueueHandlerRegistry } from './queues/handler.registry.js';
import { JobRunner } from './queues/job-runner.js';
import { QueueHost } from './queues/queue.host.js';
import { WorkerModule } from './worker.module.js';

/**
 * Compila o grafo de injecao do worker.
 *
 * Pelo mesmo motivo do teste equivalente da API: quase todo servico recebe uma
 * INTERFACE no construtor, e interface nao existe em runtime. Sem o token de
 * DI explicito, o container so falha no boot, com a mensagem inutil "can't
 * resolve dependencies (?, Object)". Um typecheck verde nao pega isso.
 *
 * Aqui vale ainda mais: o worker compoe modulos que vem de OUTRO pacote pelo
 * subcaminho `./domain`, e uma exportacao esquecida la aparece so aqui.
 */
describe('grafo de injecao do worker', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL ??= 'postgresql://baas:baas@127.0.0.1:5432/baas?schema=public';
    moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    // `compile()` NAO dispara ciclo de vida. Sem o `init()` os `onModuleInit`
    // nao rodam, e e neles que os processadores se registram — o teste
    // passaria com o registro vazio, que e justamente o defeito procurado.
    await moduleRef.init();
  }, 30_000);

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('resolve a raiz de composicao inteira', () => {
    expect(moduleRef.get(ApiConfig)).toBeInstanceOf(ApiConfig);
    expect(moduleRef.get(PrismaService)).toBeInstanceOf(PrismaService);
    expect(moduleRef.get(Metrics)).toBeInstanceOf(Metrics);
    expect(moduleRef.get(JobRunner)).toBeInstanceOf(JobRunner);
    expect(moduleRef.get(BullMqEventQueue)).toBeInstanceOf(BullMqEventQueue);
  });

  it('tem o servico de aplicacao de evento, sem o controller', () => {
    // O worker aplica evento ao dominio e nao serve rota nenhuma. Se um
    // controller entrasse no grafo, seria instanciado e nunca roteado.
    expect(moduleRef.get(WebhookApplyService)).toBeInstanceOf(WebhookApplyService);
  });

  it('tem host, varredores e ao menos um processador registrado', () => {
    // O teste que teria pego a lacuna que este commit fecha: antes dele o
    // worker compilava, subia e passava aqui — sendo so PRODUTOR. `Queue` era
    // instanciada, `Worker` nunca, e nenhum evento de outbox saia. Grafo verde
    // sem consumidor e exatamente o defeito invisivel.
    expect(moduleRef.get(QueueHost)).toBeInstanceOf(QueueHost);
    expect(moduleRef.get(SweepersService)).toBeInstanceOf(SweepersService);
    expect(moduleRef.get(QueueHandlerRegistry).kinds).toContain('outbox_dispatch');
  });

  it('NAO tem o caminho de envio de dinheiro', async () => {
    // A regra da conciliacao e "nunca reenvia". A forma mais barata de
    // garanti-la e o worker nao ter `PixTransfersService` injetavel.
    const pix = await import('@baasconn/api/domain');
    expect(Object.keys(pix)).not.toContain('PixTransfersService');
  });
});
