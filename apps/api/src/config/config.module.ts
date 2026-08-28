import { Global, Module } from '@nestjs/common';

import { clockProvider, CLOCK } from '../common/clock.js';

import { ApiConfig } from './config.service.js';

/**
 * Configuracao, global.
 *
 * Global porque praticamente todo modulo precisa de ao menos um valor daqui, e
 * o alternativo — reimportar em cada modulo — nao traz isolamento nenhum, so
 * uma linha repetida em toda declaracao.
 */
@Global()
@Module({
  providers: [ApiConfig, clockProvider],
  exports: [ApiConfig, CLOCK],
})
export class ConfigModule {}
