// O registro do OpenTelemetry precisa ser a PRIMEIRA coisa do processo: as
// instrumentacoes fazem monkey-patch de `http`, `pg` e `ioredis`, e um modulo
// carregado antes disso guarda a referencia original e nunca aparece no trace.
import '@baasconn/observability/register';

import { createServer } from 'node:http';

import { installBigIntSerializer } from '@baasconn/db';
import { Metrics } from '@baasconn/observability';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import express from 'express';

import { AppModule } from './app.module.js';
import { ApiConfig } from './config/config.service.js';

/** Rotas cujo corpo cru e capturado pelo RawBodyMiddleware. */
const RAW_BODY_PREFIX = '/webhooks/';

async function bootstrap(): Promise<void> {
  installBigIntSerializer();

  const app = await NestFactory.create(AppModule, {
    // Parser proprio: precisamos dos bytes EXATOS para verificar assinatura, e
    // o parser padrao do Nest descarta o buffer depois de parsear.
    bodyParser: false,
    bufferLogs: true,
  });

  const config = app.get(ApiConfig);
  config.validate();

  const logger = new Logger('Bootstrap');

  const jsonParser = express.json({
    limit: '1mb',
    // Guarda os bytes crus para a assinatura HMAC. Reserializar o JSON muda
    // espacamento e ordem de chave, e a assinatura deixa de conferir.
    verify: (request: express.Request & { rawBody?: Buffer }, _response, buffer) => {
      request.rawBody = Buffer.from(buffer);
    },
  });

  app.use((request: express.Request, response: express.Response, next: express.NextFunction) => {
    // Webhook tem seu proprio caminho: cap de 1 MiB, tolerancia a corpo nao
    // JSON e captura antes do parse. Deixar os dois consumirem o mesmo stream
    // faria o segundo esperar para sempre por um `end` que ja aconteceu.
    if (request.path.startsWith(RAW_BODY_PREFIX)) return next();
    return jsonParser(request, response, next);
  });

  app.enableCors({
    origin: config.consoleOrigin,
    credentials: true,
    // `Idempotency-Key` precisa ser permitido explicitamente, senao o console
    // nao consegue repetir uma operacao com seguranca.
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'Idempotency-Key',
      'X-Baas-Timestamp',
      'X-Baas-Nonce',
      'X-Baas-Signature',
      'X-Request-Id',
      'X-Correlation-Id',
    ],
    exposedHeaders: [
      'X-Request-Id',
      'X-Baas-Data-Source',
      'X-Baas-Data-Age',
      'X-Baas-Capability-Level',
      'Idempotency-Replayed',
      'Retry-After',
    ],
  });

  app.enableShutdownHooks();

  await startMetricsServer(app.get(Metrics), config, logger);

  await app.listen(config.port, '0.0.0.0');
  logger.log(`API em http://0.0.0.0:${config.port} (ambiente ${config.nodeEnv})`);
}

/**
 * Listener de metricas, em porta separada.
 *
 * `/metrics` no listener publico e vazamento (nomes de conexao, volumes,
 * cardinalidade de conta) e vetor de DoS barato: cada raspagem serializa o
 * registro inteiro. A porta 9464 fica atras da NetworkPolicy, alcancavel so
 * pelo Prometheus.
 */
async function startMetricsServer(
  metrics: Metrics,
  config: ApiConfig,
  logger: Logger,
): Promise<void> {
  const server = createServer((request, response) => {
    if (request.url !== '/metrics') {
      response.writeHead(404).end();
      return;
    }
    void metrics
      .render()
      .then((body) => {
        response.writeHead(200, { 'Content-Type': metrics.contentType }).end(body);
      })
      .catch(() => response.writeHead(500).end());
  });

  await new Promise<void>((resolve) => server.listen(config.metricsPort, '0.0.0.0', resolve));
  logger.log(`Metricas em http://0.0.0.0:${config.metricsPort}/metrics`);
}

void bootstrap();
