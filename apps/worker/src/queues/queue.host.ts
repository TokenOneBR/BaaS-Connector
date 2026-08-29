import { ApiConfig, type QueuedJob } from '@baasconn/api/domain';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';

import { BULLMQ_CONNECTION, BULLMQ_PREFIX } from './bullmq.tokens.js';
import { QueueHandlerRegistry } from './handler.registry.js';
import { JobRunner } from './job-runner.js';
import { QUEUE_FOR_KIND, QUEUE_POLICY, type QueueName } from './queue.names.js';

/**
 * O host de processadores.
 *
 * Ate este ponto o worker era so PRODUTOR: `BullMqModule` instanciava `Queue`,
 * nunca `Worker`. Um evento de outbox era reivindicado, uma entrega era
 * planejada, e nada consumia nada — a logica de entrega existia e o runtime
 * que a roda, nao. Este e o arquivo que fecha isso.
 */
@Injectable()
export class QueueHost implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(QueueHost.name);
  private readonly workers: Worker[] = [];
  private workerConnection?: Redis;

  constructor(
    private readonly config: ApiConfig,
    private readonly registry: QueueHandlerRegistry,
    private readonly runner: JobRunner,
    @Inject(BULLMQ_CONNECTION) private readonly connection: Redis,
    @Inject(BULLMQ_PREFIX) private readonly prefix: string,
  ) {}

  onApplicationBootstrap(): void {
    // Em teste o host fica parado: um consumidor de fundo consumindo enquanto
    // o teste monta o cenario transforma asserção deterministica em corrida.
    if (this.config.isTest) return;
    this.start();
  }

  /**
   * Sobe um `Worker` por fila que TEM processador.
   *
   * Filas sem processador ficam sem consumidor de proposito: um `Worker`
   * ligado a uma fila cujo tipo ninguem trata pegaria o job e o mataria com
   * "sem processador", que e pior do que deixa-lo esperando visivelmente.
   */
  start(): void {
    const filas = new Set<QueueName>(this.registry.kinds.map((kind) => QUEUE_FOR_KIND[kind]));

    // Conexao PROPRIA, e nao a do produtor. Um `Worker` do BullMQ espera job
    // com comando bloqueante (`BZPOPMIN`); dividir o socket com as `Queue`
    // faria todo `add()` ficar atras desse bloqueio. Ter a propria tambem
    // desacopla o encerramento: nao dependemos da ordem em que o Nest chama
    // os hooks de dois modulos.
    this.workerConnection = this.connection.duplicate();

    for (const name of [...filas].sort()) {
      const policy = QUEUE_POLICY[name];
      const worker = new Worker(name, (job: Job) => this.dispatch(name, job.data as QueuedJob), {
        connection: this.workerConnection,
        prefix: this.prefix,
        concurrency: policy.concurrency,
      });

      // Sem este listener o BullMQ emite `error` sem tratador e o processo
      // inteiro cai — uma oscilacao de Redis viraria reinicio de pod.
      worker.on('error', (error) => {
        this.logger.error({ err: error, queue: name }, 'Erro no processador');
      });

      this.workers.push(worker);
    }

    this.logger.log(`Host ativo com ${this.workers.length} processador(es)`);
  }

  private async dispatch(queue: QueueName, job: QueuedJob): Promise<void> {
    const handler = this.registry.handlerFor(job.kind);
    if (!handler) throw new Error(`Sem processador para "${job.kind}"`);

    // `environment` so existe em parte da uniao. Onde existe, e o que religa o
    // filtro de ambiente do Prisma dentro do job — fora de um contexto a
    // extensao `$extends` NAO filtra, e o worker rodaria com a rede desligada
    // justamente onde ninguem esta olhando.
    const environment = 'environment' in job ? job.environment : undefined;
    await this.runner.run({ queue, environment }, () => handler(job));
  }

  /** `close()` sem argumento drena o job em voo antes de soltar a fila. */
  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.workers.splice(0).map((worker) => worker.close()));
    this.workerConnection?.disconnect();
    this.workerConnection = undefined;
  }
}
