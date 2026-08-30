import {
  ApiConfig,
  CLOCK,
  EVENT_QUEUE,
  Metrics,
  WEBHOOK_DELIVERY_REPOSITORY,
  type Clock,
  type EventQueue,
  type WebhookDeliveryRepository,
} from '@baasconn/api/domain';
import { Environment } from '@baasconn/taxonomy';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';

import { UnknownOutcomeLadderService } from '../operations/ladder.service.js';
import { OutboxDispatcherService } from '../outbox/outbox-dispatcher.service.js';
import { BullMqEventQueue } from '../queues/bullmq-event-queue.js';

/** Reivindicacao do outbox e entregas vencidas: sub-minuto, as duas. */
const DISPATCH_INTERVAL_MS = 1_000;
const METRICS_INTERVAL_MS = 15_000;
/** Operacoes presas: 30 s. O saldo do cliente esta travado enquanto isso. */
const STUCK_INTERVAL_MS = 30_000;
const OUTBOX_BATCH = 500;
const DELIVERY_BATCH = 200;

/**
 * Varredores do worker.
 *
 * `setInterval().unref()` e NAO job repetivel do BullMQ, e a escolha e
 * deliberada: um cron de 1 s produziria 86 400 entradas de scheduler por dia
 * no Redis para um trabalho que o `FOR UPDATE SKIP LOCKED` ja torna seguro
 * rodar em todo pod ao mesmo tempo. Agendamento no Redis existe para o que
 * precisa rodar UMA vez no cluster — a conciliacao diaria —, nao para isto.
 */
@Injectable()
export class SweepersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SweepersService.name);
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly config: ApiConfig,
    private readonly dispatcher: OutboxDispatcherService,
    private readonly metrics: Metrics,
    private readonly bullQueue: BullMqEventQueue,
    private readonly ladder: UnknownOutcomeLadderService,
    @Inject(WEBHOOK_DELIVERY_REPOSITORY) private readonly deliveries: WebhookDeliveryRepository,
    @Inject(EVENT_QUEUE) private readonly queue: EventQueue,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    // Em teste os varredores ficam parados: um timer de fundo transforma teste
    // deterministico em teste intermitente.
    if (this.config.isTest) return;
    this.schedule(() => this.sweepOutbox(), DISPATCH_INTERVAL_MS);
    this.schedule(() => this.sweepDeliveries(), DISPATCH_INTERVAL_MS);
    this.schedule(() => this.reportMetrics(), METRICS_INTERVAL_MS);
    this.schedule(() => this.sweepStuckOperations(), STUCK_INTERVAL_MS);
    this.logger.log('Varredores ativos');
  }

  onModuleDestroy(): void {
    for (const timer of this.timers.splice(0)) clearInterval(timer);
  }

  /** Reivindica eventos novos e planeja o fan-out. */
  async sweepOutbox(): Promise<number> {
    return this.dispatcher.claimAndFanOut(OUTBOX_BATCH);
  }

  /**
   * Reenfileira entregas cuja hora chegou.
   *
   * Cobre o pod que morreu entre gravar a linha e enfileirar o job, e e o que
   * torna a escada DURAVEL em vez de depender de o Redis nunca perder nada.
   *
   * Dois pods podem reivindicar a mesma entrega — o `FOR UPDATE SKIP LOCKED`
   * do `claimDue` solta o lock no fim do statement. Nao e problema: o `jobId`
   * e `dlv-<id>` e o BullMQ recusa o segundo. A deduplicacao acontece na fila,
   * que e o lugar mais barato dela acontecer.
   */
  async sweepDeliveries(): Promise<number> {
    const now = this.clock.now();
    const vencidas = await this.deliveries.claimDue(DELIVERY_BATCH, now);

    for (const delivery of vencidas) {
      await this.queue.enqueue({
        kind: 'outbox_dispatch',
        environment: delivery.environment,
        deliveryId: delivery.id,
      });
    }
    return vencidas.length;
  }

  /**
   * Operacoes presas em desfecho desconhecido.
   *
   * O caminho quente enfileira o degrau 0 ao gravar `UNKNOWN`. Este varredor
   * pega o que foi escrito com o Redis fora — sem ele, uma operacao gravada
   * durante uma queda de fila ficaria presa para sempre com o saldo do cliente
   * travado.
   */
  async sweepStuckOperations(): Promise<number> {
    let total = 0;
    for (const environment of [Environment.HOMOLOGACAO, Environment.PRODUCAO]) {
      total += await this.ladder.sweepStuck(environment);
    }
    return total;
  }

  async reportMetrics(): Promise<void> {
    await this.dispatcher.reportMetrics();

    for (const [queue, depth] of await this.bullQueue.depth()) {
      this.metrics.queueDepth.set({ queue }, depth);
    }
    for (const [queue, failed] of await this.bullQueue.failedCount()) {
      this.metrics.dlqSize.set({ queue }, failed);
    }
  }

  private schedule(task: () => Promise<unknown>, intervalMs: number): void {
    const timer = setInterval(() => {
      void task().catch((error: unknown) => {
        // Um varredor que lanca mata o timer, e o worker fica mudo em silencio.
        this.logger.error({ err: error }, 'Varredura falhou');
      });
    }, intervalMs);
    timer.unref();
    this.timers.push(timer);
  }
}
