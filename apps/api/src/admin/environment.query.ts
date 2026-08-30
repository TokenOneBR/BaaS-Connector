import { BaasError, BaasErrorCode, Environment } from '@baasconn/taxonomy';
import { Injectable, type PipeTransform } from '@nestjs/common';
import { z } from 'zod';

import { ApiConfig } from '../config/config.service.js';

/**
 * O ambiente vem da CONSULTA, e a sessao de console nao o carrega.
 *
 * Diferente da API key, que o traz assado no proprio segredo. Adivinhar pelo
 * payload ou guardar num cookie deixaria uma sessao de homologacao resolver,
 * sem perceber, uma quebra de producao.
 *
 * Um pipe, e nao um `assertEnvironment` copiado em cada controller: com onze
 * rotas administrativas chegando, uma copia esquecida e questao de tempo, e
 * o sintoma seria agir no ambiente errado.
 */
export const zEnvironmentQuery = z.object({ environment: z.nativeEnum(Environment) });

export type EnvironmentQuery = z.infer<typeof zEnvironmentQuery>;

@Injectable()
export class ConsoleEnvironmentPipe implements PipeTransform<unknown, EnvironmentQuery> {
  constructor(private readonly config: ApiConfig) {}

  transform(value: unknown): EnvironmentQuery {
    const parsed = zEnvironmentQuery.safeParse(value);
    if (!parsed.success) {
      throw new BaasError(BaasErrorCode.VALIDATION_ERROR, {
        message: 'Informe `environment=HOMOLOGACAO` ou `environment=PRODUCAO`.',
      });
    }

    if (!this.config.environments.includes(parsed.data.environment)) {
      throw new BaasError(BaasErrorCode.VALIDATION_ERROR, {
        message: `Ambiente ${parsed.data.environment} nao esta habilitado neste deploy.`,
      });
    }

    return parsed.data;
  }
}
