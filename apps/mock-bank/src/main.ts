import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { MockBankConfig } from './config/config.service.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  // SEM `ValidationPipe`. Ele exige `class-validator` em runtime, e nao ha um
  // unico decorator de class-validator neste app — a validacao aqui e feita a
  // mao nos controllers, como um banco falso permite. O pipe nao validava
  // nada E derrubava o processo na imagem de producao, onde
  // `pnpm install --prod` remove o pacote: o Nest loga
  // "The class-validator package is missing" e o bootstrap rejeita.
  //
  // Adicionar a dependencia consertaria o crash e manteria um pipe inutil.

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
