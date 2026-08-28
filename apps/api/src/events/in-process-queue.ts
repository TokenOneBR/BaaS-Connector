import { Injectable, Logger } from '@nestjs/common';

import type { EventQueue, QueuedJob } from './outbox.types.js';

export type JobHandler = (job: QueuedJob) => Promise<void>;

/**
 * Fila em processo.
 *
 * Implementacao provisoria da porta `EventQueue`: no marco do worker ela e
 * trocada por BullMQ, e nada mais muda — `WebhookApplyService`, que tem toda a
 * logica de dominio, nao sabe qual das duas esta ligada.
 *
 * O trabalho comeca fora do turno atual (`queueMicrotask`), para o handler
 * HTTP responder antes: o alvo do webhook e p99 abaixo de 50 ms, e o provedor
 * nao pode esperar a aplicacao de dominio.
 *
 * NAO serve para producao com mais de um pod: perder o processo perde os jobs
 * em voo. E aceitavel aqui porque o evento ja esta no Postgres e o varredor
 * reenfileira o que ficou para tras — perda de fila custa latencia, nunca
 * dados.
 */
@Injectable()
export class InProcessEventQueue implements EventQueue {
  private readonly logger = new Logger(InProcessEventQueue.name);
  private handler?: JobHandler;
  private inFlight = new Set<Promise<void>>();

  setHandler(handler: JobHandler): void {
    this.handler = handler;
  }

  async enqueue(job: QueuedJob): Promise<void> {
    if (!this.handler) {
      this.logger.warn({ job }, 'Job enfileirado sem handler registrado');
      return;
    }

    const work = new Promise<void>((resolve) => {
      queueMicrotask(() => {
        void this.handler!(job)
          .catch((error: unknown) => {
            // Falha nao propaga para o handler HTTP: o provedor ja recebeu o
            // ack, e reprocessar e responsabilidade do varredor.
            this.logger.warn({ err: error, job }, 'Job falhou; sera reprocessado');
          })
          .finally(resolve);
      });
    });

    this.inFlight.add(work);
    void work.finally(() => this.inFlight.delete(work));
  }

  /** Aguarda a fila drenar. Existe para o teste, nao para producao. */
  async drain(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.all([...this.inFlight]);
    }
  }
}
