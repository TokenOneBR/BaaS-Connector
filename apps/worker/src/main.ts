// O registro do OpenTelemetry precisa ser a PRIMEIRA coisa do processo: as
// instrumentacoes fazem monkey-patch de `http`, `pg` e `ioredis`, e um modulo
// carregado antes disso guarda a referencia original e nunca aparece no trace.
import '@baasconn/observability/register';

import { ApiConfig, Metrics } from '@baasconn/api/domain';
import { installBigIntSerializer } from '@baasconn/db';
import { startMetricsServer } from '@baasconn/observability';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { WorkerModule } from './worker.module.js';

async function bootstrap(): Promise<void> {
  // Sem isto, qualquer payload de outbox que carregue centavos faz
  // `JSON.stringify` lancar, e a entrega falha para sempre em vez de falhar
  // uma vez, de forma visivel.
  installBigIntSerializer();

  // Contexto de aplicacao, e nao servidor HTTP: o worker nao serve rota
  // nenhuma. As metricas saem por um listener proprio, exatamente como na API.
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });

  const config = app.get(ApiConfig);
  // Perfil `worker`: ele nao assina token de sessao, e exigir a chave de JWT
  // dele levaria alguem a copiar a chave da API para o ambiente do worker.
  config.validate('worker');

  const logger = new Logger('Bootstrap');

  // Drena job em voo antes de morrer. Sem isto, um deploy rotineiro mata
  // entregas no meio e elas so voltam pelo varredor, minutos depois.
  app.enableShutdownHooks();

  await startMetricsServer(app.get(Metrics), config.metricsPort, (url) =>
    logger.log(`Metricas em ${url}`),
  );

  logger.log(`Worker ativo (ambiente ${config.nodeEnv})`);
}

void bootstrap();
