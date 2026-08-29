import { createLogger, Metrics } from '@baasconn/observability';
import { Global, Module } from '@nestjs/common';
import type { Logger } from 'pino';

import { ApiConfig } from '../config/config.service.js';
import { SCOPED_LOGGER } from '../providers/provider.resolver.js';

import { PinoScopedLogger } from './scoped-logger.js';

export const ROOT_LOGGER = Symbol('BAAS_ROOT_LOGGER');

/**
 * Logger e metricas.
 *
 * `@Global` porque praticamente todo modulo precisa de ao menos um dos dois, e
 * reimportar em cada um so produz ruido sem trazer isolamento real.
 */
@Global()
@Module({
  providers: [
    {
      provide: ROOT_LOGGER,
      inject: [ApiConfig],
      useFactory: (config: ApiConfig): Logger =>
        createLogger({
          // Do ambiente: o worker importa este mesmo modulo, e um log dele
          // dizendo `baas-api` mandaria quem investiga para o processo errado.
          service: process.env.SERVICE_NAME ?? 'baas-api',
          version: process.env.APP_VERSION,
          // Pretty so em desenvolvimento: exige o transport `pino-pretty`,
          // que e devDependency e nao existe na imagem de producao.
          pretty: config.nodeEnv === 'development' && process.env.LOG_PRETTY !== 'false',
          // Em teste o logger fica silencioso: saida de log nao e resultado de
          // teste, e ruido em CI esconde a falha de verdade.
          level: config.isTest ? 'silent' : undefined,
        }),
    },
    {
      provide: SCOPED_LOGGER,
      inject: [ROOT_LOGGER],
      useFactory: (logger: Logger) => new PinoScopedLogger(logger),
    },
    {
      provide: Metrics,
      useFactory: () => new Metrics({ defaultMetrics: true }),
    },
  ],
  exports: [ROOT_LOGGER, SCOPED_LOGGER, Metrics],
})
export class ObservabilityModule {}
