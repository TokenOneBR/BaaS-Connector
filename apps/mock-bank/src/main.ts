import 'reflect-metadata';

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { MockBankConfig } from './config/config.service.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: false }));

  const config = app.get(MockBankConfig);
  await app.listen(config.port, '0.0.0.0');

  const logger = new Logger('MockBank');
  logger.log(
    `Mock Bank em http://0.0.0.0:${config.port} (store=${config.store}, ISPB=${config.ispb})`,
  );
  logger.warn(
    'Este e um banco FALSO com endpoints _control sem autenticacao. ' +
      'Nunca exponha na internet nem habilite em producao.',
  );
}

void bootstrap();
