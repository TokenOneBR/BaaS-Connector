import { CLOCK, type Clock, type EventQueue, type QueuedJob } from '@baasconn/api/domain';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { QUEUE_REGISTRY, type QueueRegistry } from './bullmq.tokens.js';
import { QUEUE_FOR_KIND, jobIdOf } from './queue.names.js';

/** Intervalo entre amostras do `drain`. */
const DRAIN_POLL_MS = 10;
/** Prazo do `drain`. Estourar e defeito de teste, nao lentidao. */
const DRAIN_TIMEOUT_MS = 10_000;

@Injectable()
export class BullMqEventQueue implements EventQueue {
  private readonly logger = new Logger(BullMqEventQueue.name);

  constructor(
    @Inject(QUEUE_REGISTRY) private readonly queues: QueueRegistry,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async enqueue(job: QueuedJob, options: { delayMs?: number } = {}): Promise<void> {
    const name = QUEUE_FOR_KIND[job.kind];
    const queue = this.queues.get(name);
    if (!queue) throw new Error(`Sem fila registrada para ${job.kind}`);

    await queue.add(job.kind, job, { jobId: jobIdOf(job), delay: options.delayMs });
  }

  /**
   * Aguarda as filas drenarem. Existe para o teste, nao para producao.
   *
   * Exige DUAS amostras zeradas seguidas: um job que acabou de completar pode
   * ter enfileirado o proximo passo, e uma leitura zerada sozinha e uma
   * corrida com a propria escada.
   */
  async drain(): Promise<void> {
    const deadline = this.clock.now().getTime() + DRAIN_TIMEOUT_MS;
    let consecutivasZeradas = 0;

    while (consecutivasZeradas < 2) {
      if (this.clock.now().getTime() > deadline) {
        throw new Error(`Filas nao drenaram em ${DRAIN_TIMEOUT_MS}ms`);
      }

      const pendentes = await this.pendingCount();
      consecutivasZeradas = pendentes === 0 ? consecutivasZeradas + 1 : 0;
      if (consecutivasZeradas < 2) {
        await new Promise((resolve) => setTimeout(resolve, DRAIN_POLL_MS));
      }
    }
  }

  private async pendingCount(): Promise<number> {
    const counts = await Promise.all(
      [...this.queues.values()].map((queue) =>
        queue.getJobCounts('wait', 'active', 'delayed', 'paused', 'prioritized'),
      ),
    );
    return counts.reduce((total, byState) => total + sum(byState), 0);
  }

  /** Profundidade por fila, para a metrica. */
  async depth(): Promise<Map<string, number>> {
    const entries = await Promise.all(
      [...this.queues.entries()].map(async ([name, queue]) => {
        const counts = await queue.getJobCounts('wait', 'active', 'delayed');
        return [name, sum(counts)] as const;
      }),
    );
    return new Map(entries);
  }

  async failedCount(): Promise<Map<string, number>> {
    const entries = await Promise.all(
      [...this.queues.entries()].map(
        async ([name, queue]) => [name, await queue.getFailedCount()] as const,
      ),
    );
    return new Map(entries);
  }
}

function sum(counts: Record<string, number | undefined>): number {
  return Object.values(counts).reduce<number>((total, value) => total + (value ?? 0), 0);
}
