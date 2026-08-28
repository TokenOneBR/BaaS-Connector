import type { Clock } from '@baasconn/taxonomy';
import { Controller, Get, Inject } from '@nestjs/common';

import { Public } from '../auth/api-key.guard.js';
import { CLOCK } from '../common/clock.js';


export const READINESS_PROBES = Symbol('BAAS_READINESS_PROBES');

export interface ReadinessProbe {
  name: string;
  check(): Promise<boolean>;
}

/**
 * Sondas de saude.
 *
 * `/healthz` e liveness do PROCESSO e nao toca nada externo: se ele checasse o
 * Postgres, uma oscilacao de banco reiniciaria todos os pods e transformaria
 * degradacao em outage.
 *
 * `/readyz` checa Postgres e Redis, com resultado cacheado por 5s para a propria
 * sonda nao virar carga.
 *
 * NENHUM dos dois checa provedor terceiro. A Celcoin ter uma tarde ruim nao
 * pode fazer o Kubernetes tirar nossos pods de servico; a saude do provedor e
 * exposta em /admin/v1/providers/:id/health e como metrica de circuito.
 */
@Controller()
export class HealthController {
  private lastReadiness?: { at: number; ready: boolean; details: Record<string, boolean> };

  constructor(
    @Inject(READINESS_PROBES) private readonly probes: ReadinessProbe[],
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get('healthz')
  @Public()
  liveness(): { status: string } {
    return { status: 'ok' };
  }

  @Get('readyz')
  @Public()
  async readiness(): Promise<{ status: string; checks: Record<string, boolean> }> {
    const now = this.clock.now().getTime();
    const cached = this.lastReadiness;
    if (cached && now - cached.at < 5_000) {
      return { status: cached.ready ? 'ready' : 'not_ready', checks: cached.details };
    }

    const details: Record<string, boolean> = {};
    for (const probe of this.probes) {
      details[probe.name] = await probe.check().catch(() => false);
    }
    const ready = Object.values(details).every(Boolean);
    this.lastReadiness = { at: now, ready, details };

    return { status: ready ? 'ready' : 'not_ready', checks: details };
  }
}
