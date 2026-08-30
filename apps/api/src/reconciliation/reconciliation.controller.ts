import { zListBreaksQuery, zResolveBreak } from '@baasconn/contracts';
import {
  BaasError,
  BaasErrorCode,
  Environment,
  Money,
  type ResolutionAction,
} from '@baasconn/taxonomy';
import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { AdminSessionGuard, MinRole, type AdminRequest } from '../admin/admin-session.guard.js';
import { Public } from '../auth/api-key.guard.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { ApiConfig } from '../config/config.service.js';

import { BreakResolutionService } from './break-resolution.service.js';
import {
  RECONCILIATION_BREAK_REPOSITORY,
  type ReconciliationBreakRecord,
  type ReconciliationBreakRepository,
} from './reconciliation.types.js';

/**
 * O ambiente vem da CONSULTA, e nao da sessao.
 *
 * A sessao de console nao carrega ambiente — diferente da API key, que o
 * carrega no proprio segredo. Exigi-lo explicitamente e o que impede uma
 * sessao de homologacao de resolver, sem perceber, uma quebra de producao.
 */
const zEnvironmentQuery = z.object({ environment: z.nativeEnum(Environment) });

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
  ) {}

  /**
   * COMPLIANCE e nao OPERATOR.
   *
   * `COMPLIANCE` tem posto ABAIXO de `OPERATOR` na escala de papeis, entao
   * exigir OPERATOR trancaria justamente quem existe para olhar divergencia de
   * dinheiro fora do painel.
   */
  @Get('breaks')
  @UseGuards(AdminSessionGuard)
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

  @Get('breaks/:id')
  @UseGuards(AdminSessionGuard)
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
  @UseGuards(AdminSessionGuard)
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

/** Registro do banco (camelCase, `bigint`) para o wire (snake_case, Money). */
function toBreakDto(quebra: ReconciliationBreakRecord): Record<string, unknown> {
  return {
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
    created_at: quebra.createdAt.toISOString(),
  };
}
