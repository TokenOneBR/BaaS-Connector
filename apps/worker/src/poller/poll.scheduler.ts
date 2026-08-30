import {
  ACCOUNT_REPOSITORY,
  ApiConfig,
  CONNECTION_REPOSITORY,
  EVENT_QUEUE,
  type AccountRepository,
  type ConnectionRepository,
  type EventQueue,
} from '@baasconn/api/domain';
import { AccountStatus, SAO_PAULO_TIMEZONE } from '@baasconn/taxonomy';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';

import { QUEUE_REGISTRY, type QueueRegistry } from '../queues/bullmq.tokens.js';
import { QUEUE } from '../queues/queue.names.js';

import { STATEMENT_STREAM } from './poll.service.js';

const ACCOUNT_PAGE = 500;

/**
 * Agenda o poller.
 *
 * Uma varredura repetivel enumera as contas e enfileira um `poll` por conta,
 * pelo mesmo motivo da conciliacao: o extrato do SPI e POR CONTA, e um job
 * por conexao teria de fazer o fan-out dentro de si mesmo, ocupando um slot
 * de fila pelo tempo todo.
 *
 * A cadencia e a mesma para todo provedor, com ou sem webhook. Webhook
 * perdido e silencioso, e um PIX in perdido e incidente visivel ao cliente —
 * onde ha webhook o poller e rede de seguranca, onde nao ha e o unico
 * caminho.
 */
@Injectable()
export class PollScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(PollScheduler.name);

  constructor(
    private readonly config: ApiConfig,
    @Inject(QUEUE_REGISTRY) private readonly queues: QueueRegistry,
    @Inject(CONNECTION_REPOSITORY) private readonly connections: ConnectionRepository,
    @Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository,
    @Inject(EVENT_QUEUE) private readonly queue: EventQueue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.isTest) return;

    const fila = this.queues.get(QUEUE.poll);
    if (!fila) throw new Error('Fila de polling ausente');

    await fila.upsertJobScheduler(
      'poll-fanout',
      { pattern: '*/10 * * * *', tz: SAO_PAULO_TIMEZONE },
      { name: 'poll_fanout', data: {} },
    );
    this.logger.log('Polling agendado (a cada 10 min)');
  }

  /** Enfileira um `poll` por conta ativa de cada conexao. */
  async fanOut(): Promise<number> {
    let total = 0;

    for (const connection of await this.connections.listActive()) {
      let cursor: string | undefined;

      do {
        const page = await this.accounts.list({
          environment: connection.environment,
          connectionId: connection.id,
          status: AccountStatus.ACTIVE,
          limit: ACCOUNT_PAGE,
          cursor,
        });

        for (const account of page.data) {
          if (!account.providerAccountId) continue;
          await this.queue.enqueue({
            kind: 'poll',
            connectionId: connection.id,
            stream: STATEMENT_STREAM,
            // A conta, sempre. O cursor de polling e por conta e o `scopeId`
            // nulo escaparia da chave unica de `poll_cursor`.
            scopeId: account.id,
          });
          total += 1;
        }

        cursor = page.nextCursor;
      } while (cursor);
    }

    return total;
  }
}
