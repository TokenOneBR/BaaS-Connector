import type { QueuedJob } from '@baasconn/api/domain';
import { Injectable, Logger } from '@nestjs/common';

export type JobHandler<K extends QueuedJob['kind']> = (
  job: Extract<QueuedJob, { kind: K }>,
) => Promise<void>;

/**
 * Registro de processadores, por inversao.
 *
 * O host NAO importa os modulos de feature, e os modulos de feature nao
 * importam o host: cada um registra o seu processador aqui no proprio
 * `onModuleInit`, e o host le o registro no `onApplicationBootstrap` — que o
 * Nest garante rodar depois de todo `onModuleInit`.
 *
 * A alternativa obvia — o host importar `OutboxModule`, `ReconciliationModule`
 * e companhia — cria ciclo no instante em que um processador precisa
 * enfileirar, porque a porta `EVENT_QUEUE` mora do lado do host.
 */
@Injectable()
export class QueueHandlerRegistry {
  private readonly logger = new Logger(QueueHandlerRegistry.name);
  private readonly handlers = new Map<QueuedJob['kind'], (job: QueuedJob) => Promise<void>>();

  register<K extends QueuedJob['kind']>(kind: K, handler: JobHandler<K>): void {
    if (this.handlers.has(kind)) {
      // Dois processadores para o mesmo tipo significa que um deles nunca vai
      // rodar, e descobrir isso em producao custa uma investigacao inteira.
      throw new Error(`Ja existe processador registrado para "${kind}"`);
    }
    // O estreitamento acontece no `register`: a assinatura generica so aceita
    // um processador do MESMO `kind`, e o despacho e por essa chave. O mapa
    // guarda a forma larga porque uma uniao discriminada nao sobrevive a
    // indexacao de mapa em TypeScript.
    this.handlers.set(kind, handler as (job: QueuedJob) => Promise<void>);
    this.logger.log(`Processador registrado para ${kind}`);
  }

  handlerFor(kind: QueuedJob['kind']): ((job: QueuedJob) => Promise<void>) | undefined {
    return this.handlers.get(kind);
  }

  get kinds(): QueuedJob['kind'][] {
    return [...this.handlers.keys()];
  }
}
