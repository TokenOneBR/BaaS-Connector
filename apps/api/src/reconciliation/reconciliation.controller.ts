import {
  zListBreaksQuery,
  zReconciliationBreak,
  zReconciliationRun,
  zResolveBreak,
} from '@baasconn/contracts';
import {
  BaasError,
  BaasErrorCode,
  Environment,
  Money,
  type ResolutionAction,
} from '@baasconn/taxonomy';
import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';

import { MinRole, type AdminRequest } from '../admin/admin-session.guard.js';
import { respond } from '../admin/respond.js';
import { Public } from '../auth/api-key.guard.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { ApiConfig } from '../config/config.service.js';

import { BreakResolutionService } from './break-resolution.service.js';
import {
  RECONCILIATION_BREAK_REPOSITORY,
  RECONCILIATION_RUN_REPOSITORY,
  type ReconciliationBreakRecord,
  type ReconciliationBreakRepository,
  type ReconciliationRunRecord,
  type ReconciliationRunRepository,
} from './reconciliation.types.js';

/**
 * O ambiente vem da CONSULTA, e nao da sessao.
 *
 * A sessao de console nao carrega ambiente — diferente da API key, que o
 * carrega no proprio segredo. Exigi-lo explicitamente e o que impede uma
 * sessao de homologacao de resolver, sem perceber, uma quebra de producao.
 */
const zEnvironmentQuery = z.object({ environment: z.nativeEnum(Environment) });

const zListRunsQuery = z.object({
  connection_id: z.string().optional(),
  account_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});

const zResolveBreakBody = zResolveBreak.extend({
  /** Só usado por `ESCALATE_TO_PROVIDER`. */
  assign_to: z.string().max(128).optional(),
});

@Controller('admin/v1/reconciliation')
@Public()
export class ReconciliationController {
  constructor(
    private readonly resolution: BreakResolutionService,
    private readonly config: ApiConfig,
    @Inject(RECONCILIATION_BREAK_REPOSITORY) private readonly breaks: ReconciliationBreakRepository,
    @Inject(RECONCILIATION_RUN_REPOSITORY) private readonly runs: ReconciliationRunRepository,
  ) {}

  /**
   * COMPLIANCE e nao OPERATOR.
   *
   * `COMPLIANCE` tem posto ABAIXO de `OPERATOR` na escala de papeis, entao
   * exigir OPERATOR trancaria justamente quem existe para olhar divergencia de
   * dinheiro fora do painel.
   */
  @Get('breaks')
  @MinRole('COMPLIANCE')
  async list(
    @Query(new ZodValidationPipe(zListBreaksQuery.merge(zEnvironmentQuery)))
    query: z.infer<typeof zListBreaksQuery> & z.infer<typeof zEnvironmentQuery>,
  ) {
    this.assertEnvironment(query.environment);

    const page = await this.breaks.list({
      environment: query.environment,
      status: query.status,
      severity: query.severity,
      type: query.type,
      connectionId: query.connection_id,
      accountId: query.account_id,
      minAgeDays: query.min_age_days,
      limit: query.limit,
      cursor: query.cursor,
    });

    return {
      object: 'list' as const,
      data: page.data.map(toBreakDto),
      page: {
        has_more: page.nextCursor !== undefined,
        next_cursor: page.nextCursor ?? null,
        prev_cursor: null,
        limit: query.limit,
      },
    };
  }

  /**
   * Execucoes de conciliacao.
   *
   * Os contadores e o `balance_delta` sao gravados desde o M7 e ate agora eram
   * ILEGIVEIS: `complete()` os escrevia, o record nao os carregava e nao havia
   * listagem. O contrato descreve `balance_delta` como "numero de manchete do
   * dashboard" — e ele nao saia do banco.
   */
  @Get('runs')
  @MinRole('COMPLIANCE')
  async listRuns(
    @Query(new ZodValidationPipe(zListRunsQuery.merge(zEnvironmentQuery)))
    query: z.infer<typeof zListRunsQuery> & z.infer<typeof zEnvironmentQuery>,
  ) {
    this.assertEnvironment(query.environment);

    const page = await this.runs.list({
      environment: query.environment,
      connectionId: query.connection_id,
      accountId: query.account_id,
      limit: query.limit,
      cursor: query.cursor,
    });

    return {
      object: 'list' as const,
      data: page.data.map(toRunDto),
      page: {
        has_more: page.nextCursor !== undefined,
        next_cursor: page.nextCursor ?? null,
        prev_cursor: null,
        limit: query.limit,
      },
    };
  }

  /**
   * A evidencia dos dois lados, em rota SEPARADA.
   *
   * E um blob JSON gordo e a listagem e o caminho quente: carrega-lo em toda
   * linha da tabela para descartar quase tudo seria pagar a evidencia de
   * cinquenta quebras para mostrar uma.
   */
  @Get('breaks/:id/evidence')
  @MinRole('COMPLIANCE')
  async evidence(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(zEnvironmentQuery))
    query: z.infer<typeof zEnvironmentQuery>,
  ) {
    this.assertEnvironment(query.environment);
    const quebra = await this.breaks.findById(query.environment, id);
    if (!quebra) {
      throw new BaasError(BaasErrorCode.RESOURCE_NOT_FOUND, {
        message: `Quebra ${id} nao encontrada.`,
      });
    }

    // Os tres ids sao de `reconciliation_item` (`rci_`), nunca de transacao.
    // A tela lado a lado precisa das LINHAS, e nao dos ids.
    const [provedor, local, razao] = await Promise.all([
      quebra.providerItemId ? this.runs.findItemById(quebra.providerItemId) : undefined,
      quebra.localItemId ? this.runs.findItemById(quebra.localItemId) : undefined,
      quebra.ledgerItemId ? this.runs.findItemById(quebra.ledgerItemId) : undefined,
    ]);

    return {
      break_id: quebra.id,
      evidence: quebra.evidence,
      provider: provedor ? toItemDto(provedor) : null,
      local: local ? toItemDto(local) : null,
      ledger: razao ? toItemDto(razao) : null,
    };
  }

  @Get('breaks/:id')
  @MinRole('COMPLIANCE')
  async get(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(zEnvironmentQuery))
    query: z.infer<typeof zEnvironmentQuery>,
  ) {
    this.assertEnvironment(query.environment);
    const quebra = await this.breaks.findById(query.environment, id);
    if (!quebra) {
      throw new BaasError(BaasErrorCode.RESOURCE_NOT_FOUND, {
        message: `Quebra ${id} nao encontrada.`,
      });
    }
    return toBreakDto(quebra);
  }

  /**
   * ADMIN, e nao OPERATOR.
   *
   * Resolver uma quebra fecha uma divergencia de dinheiro, e uma das oito
   * acoes CREDITA a conta do cliente. E a mesma classe de acao que cunhar API
   * key, que ja exige papel alto.
   */
  @Post('breaks/:id/resolve')
  @MinRole('ADMIN')
  async resolve(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(zEnvironmentQuery))
    query: z.infer<typeof zEnvironmentQuery>,
    @Body(new ZodValidationPipe(zResolveBreakBody)) body: z.infer<typeof zResolveBreakBody>,
    @Req() request: AdminRequest,
  ) {
    this.assertEnvironment(query.environment);

    const resolvida = await this.resolution.resolve({
      environment: query.environment,
      breakId: id,
      action: body.action as ResolutionAction,
      note: body.note,
      // Quem resolveu vem da SESSAO, nunca do corpo: aceitar do corpo deixaria
      // qualquer administrador assinar a resolucao com o nome de outro.
      resolvedBy: request.session!.userId,
      assignTo: body.assign_to,
    });

    return toBreakDto(resolvida);
  }

  private assertEnvironment(environment: Environment): void {
    if (this.config.environments.includes(environment)) return;
    throw new BaasError(BaasErrorCode.VALIDATION_ERROR, {
      message: `Ambiente ${environment} nao esta habilitado neste deploy.`,
    });
  }
}

/**
 * Registro do banco (camelCase, `bigint`) para o wire (snake_case, Money).
 *
 * Passa por `respond`, entao o contrato e quem limita a resposta. Foi assim
 * que dois defeitos apareceram: `evidence` era declarada obrigatoria e nunca
 * saia do banco, e `adjustment_transaction_id` saia sem estar declarada.
 */
function toBreakDto(quebra: ReconciliationBreakRecord) {
  return respond(zReconciliationBreak, {
    id: quebra.id,
    run_id: quebra.runId,
    first_seen_run_id: quebra.firstSeenRunId,
    connection_id: quebra.connectionId,
    account_id: quebra.accountId ?? null,
    type: quebra.type,
    severity: quebra.severity,
    status: quebra.status,
    amount: quebra.amountCents === undefined ? null : Money.of(quebra.amountCents).toJSON(),
    delta: quebra.deltaCents === undefined ? null : Money.of(quebra.deltaCents).toJSON(),
    effective_date: quebra.effectiveDate,
    end_to_end_id: quebra.endToEndId ?? null,
    description: quebra.description,
    age_days: quebra.ageDays,
    assigned_to: quebra.assignedTo ?? null,
    resolution: quebra.resolution ?? null,
    resolution_note: quebra.resolutionNote ?? null,
    resolved_by: quebra.resolvedBy ?? null,
    resolved_at: quebra.resolvedAt?.toISOString() ?? null,
    adjustment_transaction_id: quebra.adjustmentTransactionId ?? null,
    evidence: quebra.evidence,
    created_at: quebra.createdAt.toISOString(),
  });
}

function toRunDto(run: ReconciliationRunRecord) {
  return respond(zReconciliationRun, {
    id: run.id,
    connection_id: run.connectionId,
    environment: run.environment,
    account_id: run.accountId,
    scope: run.scope,
    window_start: run.windowStart.toISOString(),
    window_end: run.windowEnd.toISOString(),
    status: run.status,
    provider_item_count: run.counters?.providerItemCount ?? 0,
    local_item_count: run.counters?.localItemCount ?? 0,
    ledger_item_count: run.counters?.ledgerItemCount ?? 0,
    matched_count: run.counters?.matchedCount ?? 0,
    break_count: run.counters?.breakCount ?? 0,
    balance_delta:
      run.balances?.balanceDeltaCents === undefined
        ? null
        : Money.of(run.balances.balanceDeltaCents).toJSON(),
    started_at: run.startedAt?.toISOString() ?? null,
    finished_at: run.finishedAt?.toISOString() ?? null,
    triggered_by: run.triggeredBy,
  });
}

/** Item normalizado de um dos tres lados, para a tela lado a lado. */
function toItemDto(item: {
  id: string;
  side: string;
  externalId?: string;
  endToEndId?: string;
  postedAt: Date;
  effectiveDate: string;
  direction: string;
  amountCents: bigint;
  type: string;
}) {
  return {
    id: item.id,
    side: item.side,
    external_id: item.externalId ?? null,
    end_to_end_id: item.endToEndId ?? null,
    posted_at: item.postedAt.toISOString(),
    effective_date: item.effectiveDate,
    direction: item.direction,
    amount: Money.of(item.amountCents).toJSON(),
    type: item.type,
  };
}
