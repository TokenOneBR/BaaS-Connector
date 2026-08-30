import { zOverview } from '@baasconn/contracts';
import {
  AccountStatus,
  BreakSeverity,
  Money,
  TransactionDirection,
  TransactionStatus,
  type Clock,
} from '@baasconn/taxonomy';
import { Controller, Get, Inject, Query } from '@nestjs/common';

import { ACCOUNT_REPOSITORY, type AccountRepository } from '../accounts/accounts.types.js';
import { Public } from '../auth/api-key.guard.js';
import { CLOCK } from '../common/clock.js';
import {
  OUTBOX_DISPATCH_REPOSITORY,
  type OutboxDispatchRepository,
} from '../events/outbox-delivery.types.js';
import { TRANSACTION_REPOSITORY, type TransactionRepository } from '../pix/pix.types.js';
import {
  RECONCILIATION_BREAK_REPOSITORY,
  RECONCILIATION_RUN_REPOSITORY,
  type ReconciliationBreakRepository,
  type ReconciliationRunRepository,
} from '../reconciliation/reconciliation.types.js';

import { MinRole } from './admin-session.guard.js';
import { ConsoleEnvironmentPipe, type EnvironmentQuery } from './environment.query.js';
import { respond } from './respond.js';

/** Teto de leitura por agregado. O painel resume, nao pagina. */
const AMOSTRA = 500;

/**
 * Agregado do painel.
 *
 * UMA rota, e nao nove. O painel nao pode custar nove idas ao BFF, cada uma
 * com round-trip de sessao — e um agregado proprio le o necessario em vez de
 * paginar quatro listas para descartar quase tudo.
 *
 * `VIEWER`: o painel nao mostra documento, credencial nem segredo. E o
 * primeiro que qualquer pessoa da operacao ve ao entrar.
 */
@Controller('admin/v1/overview')
@Public()
export class OverviewController {
  constructor(
    @Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository,
    @Inject(TRANSACTION_REPOSITORY) private readonly transactions: TransactionRepository,
    @Inject(RECONCILIATION_BREAK_REPOSITORY) private readonly breaks: ReconciliationBreakRepository,
    @Inject(RECONCILIATION_RUN_REPOSITORY) private readonly runs: ReconciliationRunRepository,
    @Inject(OUTBOX_DISPATCH_REPOSITORY) private readonly outbox: OutboxDispatchRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get()
  @MinRole('VIEWER')
  async get(
    @Query(ConsoleEnvironmentPipe) env: EnvironmentQuery,
    @Query('window_hours') windowHours?: string,
  ) {
    const janela = Number(windowHours ?? 24);
    const environment = env.environment;

    const [contas, movimentos, quebras, execucoes, despacho] = await Promise.all([
      this.accounts.list({ environment, limit: AMOSTRA }),
      this.transactions.list({ environment, limit: AMOSTRA }),
      this.breaks.list({ environment, limit: AMOSTRA }),
      this.runs.list({ environment, limit: 1 }),
      this.outbox.pendingStats(),
    ]);

    const desde = new Date(this.clock.now().getTime() - janela * 3_600_000);
    const naJanela = movimentos.data.filter((row) => row.requestedAt >= desde);
    const entradas = naJanela.filter((row) => row.direction === TransactionDirection.CREDIT);
    const saidas = naJanela.filter((row) => row.direction === TransactionDirection.DEBIT);

    const ultima = execucoes.data[0];

    return respond(zOverview, {
      environment,
      window_hours: janela,
      accounts: {
        total: contas.data.length,
        active: contas.data.filter((row) => row.status === AccountStatus.ACTIVE).length,
        pending_onboarding: contas.data.filter(
          (row) => row.status === AccountStatus.PENDING_ONBOARDING,
        ).length,
        blocked: contas.data.filter((row) => row.status === AccountStatus.BLOCKED).length,
      },
      pix: {
        in_count: entradas.length,
        out_count: saidas.length,
        in_amount: soma(entradas),
        out_amount: soma(saidas),
        settled: naJanela.filter((row) => row.status === TransactionStatus.SETTLED).length,
        failed: naJanela.filter((row) => row.status === TransactionStatus.FAILED).length,
        // `UNKNOWN` tem coluna propria no painel de proposito: e o estado que
        // significa "o dinheiro pode ter saido e nao sabemos", e some se for
        // contado junto com falha.
        unknown: naJanela.filter((row) => row.status === TransactionStatus.UNKNOWN).length,
      },
      reconciliation: {
        open_breaks: quebras.data.length,
        critical_breaks: quebras.data.filter((row) => row.severity === BreakSeverity.CRITICAL)
          .length,
        // Nulo, e nao zero: zero mentiria "conciliado ha pouco" num deploy que
        // nunca conciliou, e o alerta de obsolescencia le exatamente isto.
        last_success_at: ultima?.finishedAt?.toISOString() ?? null,
      },
      outbox: {
        pending: despacho.pending,
        oldest_age_seconds: despacho.oldestAgeSeconds ?? null,
      },
    });
  }
}

function soma(rows: readonly { amountCents: bigint }[]) {
  return Money.of(rows.reduce((total, row) => total + row.amountCents, 0n)).toJSON();
}
