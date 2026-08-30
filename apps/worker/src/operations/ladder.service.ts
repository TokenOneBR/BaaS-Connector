import {
  CLOCK,
  EVENT_QUEUE,
  OPERATION_REPOSITORY,
  OperationReconciler,
  RECONCILIATION_BREAK_REPOSITORY,
  RECONCILIATION_RUN_REPOSITORY,
  type Clock,
  type EventQueue,
  type OperationRecord,
  type OperationRepository,
  type ReconciliationBreakRepository,
  type ReconciliationRunRepository,
} from '@baasconn/api/domain';
import {
  BreakSeverity,
  BreakType,
  Environment,
  ReconciliationScope,
  UNKNOWN_OUTCOME_LADDER_SECONDS,
  newId,
  toEffectiveDate,
} from '@baasconn/taxonomy';
import { Inject, Injectable, Logger } from '@nestjs/common';

/** Operacoes presas por varredura. */
const STUCK_BATCH = 100;

/**
 * Escada do desfecho desconhecido.
 *
 * CONSULTA o provedor pela nossa chave, degrau a degrau. Nunca reenvia — e a
 * regra central da ADR 0015, e a forma mais barata de garanti-la e este
 * servico nao ter como: `PixTransfersService` nao esta no grafo do worker.
 */
@Injectable()
export class UnknownOutcomeLadderService {
  private readonly logger = new Logger(UnknownOutcomeLadderService.name);

  constructor(
    private readonly reconciler: OperationReconciler,
    @Inject(OPERATION_REPOSITORY) private readonly operations: OperationRepository,
    @Inject(RECONCILIATION_RUN_REPOSITORY) private readonly runs: ReconciliationRunRepository,
    @Inject(RECONCILIATION_BREAK_REPOSITORY) private readonly breaks: ReconciliationBreakRepository,
    @Inject(EVENT_QUEUE) private readonly queue: EventQueue,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Um degrau. O proximo e agendado daqui, se houver. */
  async step(environment: Environment, operationId: string, step: number): Promise<void> {
    const outcome = await this.reconciler.resolve(environment, operationId);

    if (outcome.resolved) {
      this.logger.log({ operation_id: operationId, status: outcome.status }, 'Desfecho resolvido');
      return;
    }

    if (outcome.reason === 'not_stuck') return;

    if (outcome.reason === 'no_lookup_capability') {
      // PARA aqui, e nao no degrau 7. Sem consulta a escada nunca conclui
      // nada, e insistir sete vezes num provedor que nao tem como responder e
      // so gastar tempo ate concluir errado.
      await this.exhaust(environment, operationId, 'no_lookup_capability');
      return;
    }

    const proximo = step + 1;
    const atrasoSegundos = UNKNOWN_OUTCOME_LADDER_SECONDS[proximo];

    if (atrasoSegundos === undefined) {
      await this.exhaust(environment, operationId, 'not_found_after_ladder');
      return;
    }

    await this.operations.update({
      environment,
      id: operationId,
      nextTryAt: new Date(this.clock.now().getTime() + atrasoSegundos * 1000),
    } as never);

    await this.queue.enqueue(
      { kind: 'operation_resolve', environment, operationId, step: proximo },
      { delayMs: atrasoSegundos * 1000 },
    );
  }

  /**
   * Fim da escada.
   *
   * **A linha mais perigosa do marco:** `ProviderOperation` vai a `FAILED` e
   * NADA toca a `Transaction`. Leva-la a FAILED dispararia `voidOut` e
   * devolveria ao cliente um saldo que talvez ja tenha saido da conta dele no
   * provedor — ele gastaria o mesmo dinheiro duas vezes, e a segunda seria
   * culpa nossa.
   *
   * Esgotar nao conclui que o pagamento falhou. Conclui que NOS nao
   * conseguimos descobrir, e isso e trabalho humano.
   */
  private async exhaust(
    environment: Environment,
    operationId: string,
    reason: string,
  ): Promise<void> {
    const operation = await this.operations.findById(environment, operationId);
    if (!operation) return;

    await this.operations.update({
      environment,
      id: operationId,
      status: 'FAILED',
      lastError: { reason },
    });

    await this.openBreak(operation, reason);
    this.logger.warn(
      { operation_id: operationId, reason },
      'Escada esgotada: operacao FAILED, transacao INTOCADA, quebra aberta',
    );
  }

  /**
   * Quebra para revisao humana.
   *
   * `ReconciliationBreak.runId` e FK obrigatoria, entao o esgotamento cria um
   * run sintetico so para pendurar a quebra. `accountId` vem da operacao e
   * nunca e nulo, pela mesma razao de sempre: NULL escaparia da chave unica.
   */
  private async openBreak(operation: OperationRecord, reason: string): Promise<void> {
    const now = this.clock.now();
    const accountId = operation.accountId;
    if (!accountId) return;

    const { run } = await this.runs.startRun({
      id: newId('reconciliationRun'),
      environment: operation.environment,
      connectionId: operation.connectionId,
      accountId,
      scope: ReconciliationScope.MANUAL,
      windowStart: operation.createdAt,
      windowEnd: now,
      triggeredBy: 'worker:unknown-outcome-ladder',
    });

    await this.breaks.upsertMany(
      [
        {
          id: newId('reconciliationBreak'),
          environment: operation.environment,
          runId: run.id,
          connectionId: operation.connectionId,
          accountId,
          type: BreakType.MISSING_ON_PROVIDER,
          // Sempre critico: pode significar que o dinheiro saiu da conta do
          // cliente no provedor e nos nunca soubemos.
          severity: BreakSeverity.CRITICAL,
          dedupeKey: `opr:${operation.id}`,
          effectiveDate: toEffectiveDate(now),
          endToEndId: operation.endToEndId ?? undefined,
          amountCents: operation.amountCents ?? undefined,
          description: 'Desfecho desconhecido nao resolvido pela escada de consultas',
          evidence: {
            operation_id: operation.id,
            motivo: reason,
            tentativas: operation.attempts,
          },
        },
      ],
      now,
    );
  }

  /**
   * Varredura das que ficaram para tras.
   *
   * O caminho quente enfileira o degrau 0 ao gravar `UNKNOWN`. Este varredor
   * existe para o que foi escrito com o Redis fora, e para o que e anterior ao
   * worker: sem ele, uma operacao gravada durante uma queda de fila ficaria
   * presa para sempre com o saldo do cliente travado.
   */
  async sweepStuck(environment: Environment): Promise<number> {
    const now = this.clock.now();
    const presas = await this.operations.findStuck(environment, STUCK_BATCH);
    const vencidas = presas.filter((op) => !op.nextTryAt || op.nextTryAt <= now);

    for (const operation of vencidas) {
      await this.queue.enqueue({
        kind: 'operation_resolve',
        environment,
        operationId: operation.id,
        // O degrau vem das tentativas ja feitas: reenfileirar sempre no zero
        // faria uma operacao presa refazer a escada inteira a cada varredura.
        step: Math.min(operation.attempts, UNKNOWN_OUTCOME_LADDER_SECONDS.length - 1),
      });
    }

    return vencidas.length;
  }
}
