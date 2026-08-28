import { Logger, type Provider } from '@nestjs/common';
import IORedis, { type Redis } from 'ioredis';

import { ApiConfig } from '../config/config.service.js';

export const REDIS = Symbol('BAAS_REDIS');

/**
 * Conexao Redis.
 *
 * `lazyConnect` de proposito: o Redis e cache e coordenacao, nunca sistema de
 * registro. Falhar o boot porque o cache ainda nao subiu transformaria uma
 * degradacao tolerada numa indisponibilidade total.
 *
 * `maxRetriesPerRequest: 1` mantem a falha rapida: um comando que fica
 * repetindo por segundos ocupa o caminho de requisicao que ele deveria
 * acelerar.
 */
export const redisProvider: Provider = {
  provide: REDIS,
  inject: [ApiConfig],
  useFactory: (config: ApiConfig): Redis => {
    const logger = new Logger('Redis');
    const client = new IORedis(config.redisUrl || 'redis://127.0.0.1:6379', {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 3_000,
    });

    client.on('error', (error) => logger.warn({ err: error }, 'Erro de conexao com o Redis'));

    if (!config.isTest) {
      void client.connect().catch((error: unknown) => {
        logger.warn({ err: error }, 'Redis indisponivel no boot; seguira tentando');
      });
    }

    return client;
  },
};
