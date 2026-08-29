import { randomUUID } from 'node:crypto';

import { CLOCK, Metrics, type Clock } from '@baasconn/api/domain';
import { runWithContext } from '@baasconn/observability';
import type { Environment } from '@baasconn/taxonomy';
import { Inject, Injectable, Logger } from '@nestjs/common';

export interface JobContext {
  queue: string;
  environment?: Environment;
  correlationId?: string;
}

/**
 * Executa um job com contexto, metrica e log.
 *
 * O `runWithContext` NAO e cosmetico. A extensao `$extends` do Prisma le
 * `getContext()?.environment` para filtrar toda consulta por ambiente; fora de
 * um contexto ela nao filtra. Uma requisicao HTTP sempre tem contexto, um job
 * de fila nao tem nenhum — entao sem isto o worker rodaria com a rede de
 * protecao de ambiente desligada, justamente onde ninguem esta olhando.
 */
@Injectable()
export class JobRunner {
  private readonly logger = new Logger(JobRunner.name);

  constructor(
    private readonly metrics: Metrics,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async run<T>(context: JobContext, task: () => Promise<T>): Promise<T> {
    const started = process.hrtime.bigint();
    const correlationId = context.correlationId ?? randomUUID();

    try {
      const result = await runWithContext(
        {
          requestId: correlationId,
          correlationId,
          environment: context.environment,
          actorType: 'SYSTEM',
          startedAtMs: this.clock.now().getTime(),
        },
        task,
      );
      this.observe(context.queue, 'success', started);
      return result;
    } catch (error) {
      this.observe(context.queue, 'failure', started);
      this.logger.error(
        { err: error, queue: context.queue, correlation_id: correlationId },
        'Job falhou',
      );
      throw error;
    }
  }

  private observe(queue: string, outcome: 'success' | 'failure', started: bigint): void {
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    this.metrics.jobDuration.observe({ queue, outcome }, seconds);
  }
}
