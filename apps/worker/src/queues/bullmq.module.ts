import { ApiConfig } from '@baasconn/api/domain';
import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import { BullMqEventQueue } from './bullmq-event-queue.js';
import {
  BULLMQ_CONNECTION,
  BULLMQ_PREFIX,
  QUEUE_REGISTRY,
  createBullConnection,
  type QueueRegistry,
} from './bullmq.tokens.js';
import { QUEUE } from './queue.names.js';

@Global()
@Module({
  providers: [
    {
      provide: BULLMQ_CONNECTION,
      inject: [ApiConfig],
      useFactory: (config: ApiConfig) =>
        createBullConnection(config.redisUrl || 'redis://127.0.0.1:6379'),
    },
    {
      provide: QUEUE_REGISTRY,
      inject: [BULLMQ_CONNECTION],
      useFactory: (connection: Redis): QueueRegistry =>
        new Map(
          Object.values(QUEUE).map((name) => [
            name,
            new Queue(name, {
              connection,
              prefix: BULLMQ_PREFIX,
              defaultJobOptions: {
                // Retencao curta no sucesso e longa na falha: um job que deu
                // certo nao tem historia, um que falhou e o unico rastro que
                // existe antes de alguem abrir o Postgres.
                removeOnComplete: { age: 3_600, count: 1_000 },
                removeOnFail: { age: 7 * 24 * 3_600 },
              },
            }),
          ]),
        ),
    },
    BullMqEventQueue,
  ],
  exports: [BULLMQ_CONNECTION, QUEUE_REGISTRY, BullMqEventQueue],
})
export class BullMqModule implements OnApplicationShutdown {
  private readonly logger = new Logger(BullMqModule.name);

  constructor(
    @Inject(QUEUE_REGISTRY) private readonly queues: QueueRegistry,
    @Inject(BULLMQ_CONNECTION) private readonly connection: Redis,
  ) {}

  /**
   * Encerra as filas antes de soltar a conexao.
   *
   * A ordem importa: fechar o socket primeiro faria todo `close()` de fila
   * pendurar ate o timeout, e o pod levaria o tempo de graca inteiro para
   * morrer — que e como um deploy rotineiro vira alarme de disponibilidade.
   */
  async onApplicationShutdown(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    this.connection.disconnect();
    this.logger.log('Filas encerradas');
  }
}
