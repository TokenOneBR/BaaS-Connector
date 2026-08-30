import { ApiConfig } from '@baasconn/api/domain';
import { ReconciliationScope, SAO_PAULO_TIMEZONE } from '@baasconn/taxonomy';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';

import { QUEUE_REGISTRY, type QueueRegistry } from '../queues/bullmq.tokens.js';
import { QUEUE, jobIdOf } from '../queues/queue.names.js';

/**
 * Agendamento no BullMQ, e nao `@nestjs/schedule`.
 *
 * Um `@Cron` dispara em TODO pod: tres replicas produziriam tres varreduras
 * as 03:00, e a chave unica de `ReconciliationRun` transformaria duas delas em
 * violacao de constraint — desfecho correto, sinal horrivel, e as chamadas ao
 * provedor ja gastas. O agendador do BullMQ produz um job por intervalo no
 * cluster inteiro.
 *
 * E sobrevive a restart: um cluster fora do ar das 02:55 as 03:05 dispara
 * ATRASADO em vez de nunca. Para conciliacao diaria, atrasado e nunca sao
 * incidentes diferentes.
 *
 * `tz` e nome de fuso, nunca offset cravado: com `-03:00` a diaria roda uma
 * hora fora do lugar metade do ano.
 */
@Injectable()
export class ReconciliationScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReconciliationScheduler.name);

  constructor(
    private readonly config: ApiConfig,
    @Inject(QUEUE_REGISTRY) private readonly queues: QueueRegistry,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.isTest) return;
    await this.register();
  }

  async register(): Promise<void> {
    const fila = this.queues.get(QUEUE.maintenance);
    if (!fila) throw new Error('Fila de manutencao ausente');

    const agendamentos: Array<{ scope: ReconciliationScope; pattern: string }> = [
      // 03:00 de Brasilia: o extrato do dia anterior ja postou.
      { scope: ReconciliationScope.DAILY, pattern: '0 3 * * *' },
      { scope: ReconciliationScope.INTRADAY, pattern: '*/30 * * * *' },
    ];

    for (const { scope, pattern } of agendamentos) {
      const job = { kind: 'reconciliation_sweep' as const, scope };
      await fila.upsertJobScheduler(
        jobIdOf(job),
        { pattern, tz: SAO_PAULO_TIMEZONE },
        { name: job.kind, data: job },
      );
    }

    this.logger.log('Conciliacao agendada (diaria 03:00 BRT, intraday a cada 30 min)');
  }
}
