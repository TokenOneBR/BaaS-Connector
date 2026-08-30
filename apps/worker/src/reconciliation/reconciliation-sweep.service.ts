import {
  ACCOUNT_REPOSITORY,
  CLOCK,
  CONNECTION_REPOSITORY,
  EVENT_QUEUE,
  RECONCILIATION_RUN_REPOSITORY,
  type AccountRepository,
  type ConnectionRepository,
  type EventQueue,
  type ReconciliationRunRepository,
} from '@baasconn/api/domain';
import {
  AccountStatus,
  ReconciliationScope,
  SAO_PAULO_TIMEZONE,
  newId,
  type Clock,
} from '@baasconn/taxonomy';
import { Inject, Injectable, Logger } from '@nestjs/common';

/** Contas por pagina ao enumerar. */
const ACCOUNT_PAGE = 500;
/** Janela da intraday. Larga o bastante para o atraso de postagem caber. */
const INTRADAY_WINDOW_HOURS = 4;

/**
 * Cria as execucoes do periodo e as enfileira.
 *
 * Varre TODAS as contas ativas da conexao, e nao so as que tiveram movimento
 * nosso na janela. A economia obvia — conciliar so onde ha transacao nossa —
 * tem um defeito fatal: a conta que RECEBEU um Pix cujo webhook se perdeu nao
 * tem movimento nosso nenhum, entao nunca entraria na varredura. E exatamente
 * o `MISSING_ON_LOCAL` de maior valor que a conciliacao existe para achar.
 *
 * O custo e O(contas) chamadas de extrato por dia, e e aceito. Como o fan-out
 * e um job de fila, limitar taxa depois e configuracao, nao redesenho.
 */
@Injectable()
export class ReconciliationSweepService {
  private readonly logger = new Logger(ReconciliationSweepService.name);

  constructor(
    @Inject(CONNECTION_REPOSITORY) private readonly connections: ConnectionRepository,
    @Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository,
    @Inject(RECONCILIATION_RUN_REPOSITORY) private readonly runs: ReconciliationRunRepository,
    @Inject(EVENT_QUEUE) private readonly queue: EventQueue,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async sweep(scope: ReconciliationScope): Promise<number> {
    const janela = this.window(scope);
    let criados = 0;

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
          // Sem `providerAccountId` nao ha o que consultar no provedor: a
          // conta existe do nosso lado e ainda nao foi aberta no deles.
          if (!account.providerAccountId) continue;

          const { run, created } = await this.runs.startRun({
            id: newId('reconciliationRun'),
            environment: connection.environment,
            connectionId: connection.id,
            // NUNCA nulo: em Postgres NULL nao e igual a NULL num indice
            // unico, e um run de conexao inteira escaparia da deduplicacao.
            accountId: account.id,
            scope,
            windowStart: janela.start,
            windowEnd: janela.end,
            triggeredBy: `worker:${scope.toLowerCase()}`,
          });

          // Ja existia: outro pod pegou esta janela. Nao reenfileira.
          if (!created) continue;

          await this.queue.enqueue({
            kind: 'reconciliation',
            environment: connection.environment,
            runId: run.id,
          });
          criados += 1;
        }

        cursor = page.nextCursor;
      } while (cursor);
    }

    this.logger.log({ scope, criados }, 'Varredura de conciliacao concluida');
    return criados;
  }

  /**
   * Janela do periodo, em horario de Brasilia.
   *
   * A diaria olha o DIA UTIL ANTERIOR inteiro: as 03:00 o extrato do dia
   * anterior ja postou. A intraday olha as ultimas horas e dobra de rede de
   * seguranca para webhook perdido — por isso a sobreposicao entre execucoes
   * e desejada, nao um defeito: o guard monotonico a absorve.
   */
  private window(scope: ReconciliationScope): { start: Date; end: Date } {
    const agora = this.clock.now();

    if (scope === ReconciliationScope.INTRADAY) {
      return {
        start: new Date(agora.getTime() - INTRADAY_WINDOW_HOURS * 3_600_000),
        end: agora,
      };
    }

    const ontem = brasiliaDay(new Date(agora.getTime() - 86_400_000));
    return {
      start: new Date(`${ontem}T00:00:00.000Z`),
      end: new Date(`${ontem}T23:59:59.999Z`),
    };
  }
}

function brasiliaDay(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SAO_PAULO_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}
