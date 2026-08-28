import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';

import { MockBankStore, FaultConfig } from './store.js';

/**
 * Injecao de falha.
 *
 * Aplica latencia, taxa de erro e status forcado. Configuravel globalmente por
 * `_control/faults`, ou por requisicao pelo header `X-Mock-Scenario`.
 *
 * A razao de existir: as falhas interessantes de uma integracao com BaaS nao
 * sao o caminho feliz, sao o 429 no meio da folha, o 500 intermitente e a
 * latencia que estoura o timeout. Sem poder injetar isso, o codigo de retry e
 * circuit breaker do conector nunca e exercitado.
 */
@Injectable()
export class FaultInterceptor implements NestInterceptor {
  constructor(private readonly store: MockBankStore) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<Request>();
    const scenario = request.headers['x-mock-scenario'];
    const faults = this.resolve(typeof scenario === 'string' ? scenario : undefined);

    // O painel de controle precisa continuar respondendo mesmo com caos
    // ligado, senao nao da para desliga-lo.
    if (request.path.startsWith('/_control')) return next.handle();

    if (faults.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, faults.latencyMs));
    }

    if (faults.forceStatus) {
      throw new HttpException(
        { error: { code: 'MB-CHAOS-FORCED', message: `Status ${faults.forceStatus} forcado.` } },
        faults.forceStatus,
      );
    }

    if (faults.errorRate > 0 && Math.random() < faults.errorRate) {
      throw new HttpException(
        { error: { code: 'MB-CHAOS-RANDOM', message: 'Falha aleatoria injetada.' } },
        503,
      );
    }

    return next.handle();
  }

  private resolve(scenario?: string): FaultConfig {
    if (!scenario) return this.store.faults;
    switch (scenario) {
      case 'slow':
        return { ...this.store.faults, latencyMs: 5_000 };
      case 'rate-limited':
        return { ...this.store.faults, forceStatus: 429 };
      case 'unavailable':
        return { ...this.store.faults, forceStatus: 503 };
      case 'server-error':
        return { ...this.store.faults, forceStatus: 500 };
      default:
        return this.store.faults;
    }
  }
}
