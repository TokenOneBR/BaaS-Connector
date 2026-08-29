import { zListTransactionsQuery, zStatementQuery } from '@baasconn/contracts';
import { BaasError, BaasErrorCode } from '@baasconn/taxonomy';
import { Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { z } from 'zod';

import { actorOf } from '../accounts/accounts.controller.js';
import { Scopes, type AuthedRequest } from '../auth/api-key.guard.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';

import { OperationReconciler } from './operation-reconciler.js';
import { toTransactionDto } from './pix-transfers.service.js';
import {
  OPERATION_REPOSITORY,
  TRANSACTION_REPOSITORY,
  type OperationRecord,
  type OperationRepository,
  type TransactionRepository,
} from './pix.types.js';
import { StatementService } from './statement.service.js';

@Controller('v1')
export class TransactionsController {
  constructor(
    private readonly statement: StatementService,
    private readonly reconciler: OperationReconciler,
    @Inject(TRANSACTION_REPOSITORY) private readonly transactions: TransactionRepository,
    @Inject(OPERATION_REPOSITORY) private readonly operations: OperationRepository,
  ) {}

  @Get('transactions/:id')
  @Scopes('pix:read')
  async get(@Param('id') id: string, @Req() request: AuthedRequest) {
    const actor = actorOf(request);
    const transaction = await this.transactions.findById(actor.environment, id);
    if (!transaction) {
      throw new BaasError(BaasErrorCode.TRANSACTION_NOT_FOUND, {
        message: `Transacao ${id} nao encontrada.`,
      });
    }
    return toTransactionDto(transaction);
  }

  @Get('transactions')
  @Scopes('pix:read')
  async list(
    @Query(new ZodValidationPipe(zListTransactionsQuery))
    query: z.infer<typeof zListTransactionsQuery>,
    @Req() request: AuthedRequest,
  ) {
    const actor = actorOf(request);
    const page = await this.transactions.list({
      environment: actor.environment,
      accountId: query.account_id,
      status: query.status,
      direction: query.direction,
      endToEndId: query.end_to_end_id,
      limit: query.limit,
      cursor: query.cursor,
    });

    return {
      object: 'list' as const,
      data: page.data.map(toTransactionDto),
      page: {
        has_more: page.nextCursor !== undefined,
        next_cursor: page.nextCursor ?? null,
        prev_cursor: null,
        limit: query.limit,
      },
    };
  }

  /**
   * Extrato da conta.
   *
   * So estados que JA ACONTECERAM entram. Uma transferencia em voo num
   * extrato faria o cliente conciliar contra um movimento que ainda pode ser
   * desfeito — e um extrato que muda retroativamente nao e extrato.
   */
  @Get('accounts/:accountId/statement')
  @Scopes('statement:read')
  async listStatement(
    @Param('accountId') accountId: string,
    @Query(new ZodValidationPipe(zStatementQuery)) query: z.infer<typeof zStatementQuery>,
    @Req() request: AuthedRequest,
  ) {
    const actor = actorOf(request);
    const page = await this.statement.list({
      environment: actor.environment,
      accountId,
      from: query.from,
      to: query.to,
      limit: query.limit,
      cursor: query.cursor,
    });

    return {
      object: 'list' as const,
      data: page.data,
      page: {
        has_more: page.nextCursor !== undefined,
        next_cursor: page.nextCursor ?? null,
        prev_cursor: null,
        limit: query.limit,
      },
    };
  }

  /**
   * Estado de uma operacao assincrona.
   *
   * E o endpoint que o cliente consulta depois de um 202, EM VEZ de retentar
   * a transferencia. Toda a razao de existir do 202 e ter isto aqui.
   */
  @Get('operations/:id')
  @Scopes('pix:read')
  async operation(@Param('id') id: string, @Req() request: AuthedRequest) {
    const actor = actorOf(request);
    const operation = await this.operations.findById(actor.environment, id);
    if (!operation) {
      throw new BaasError(BaasErrorCode.RESOURCE_NOT_FOUND, {
        message: `Operacao ${id} nao encontrada.`,
      });
    }
    return toOperationDto(operation);
  }

  /**
   * Forca uma tentativa de resolucao.
   *
   * Consulta o provedor; NUNCA reenvia. Existe para o suporte poder destravar
   * um caso sem esperar a escada do worker, e para o e2e exercitar o caminho.
   */
  @Post('operations/:id/reconcile')
  @Scopes('pix:write')
  async reconcile(@Param('id') id: string, @Req() request: AuthedRequest) {
    const actor = actorOf(request);
    const result = await this.reconciler.resolve(actor.environment, id);
    const operation = await this.operations.findById(actor.environment, id);

    return {
      ...toOperationDto(operation!),
      resolved: result.resolved,
      reason: result.resolved ? null : result.reason,
      transaction: result.resolved ? toTransactionDto(result.transaction) : null,
    };
  }
}

export function toOperationDto(operation: OperationRecord) {
  return {
    id: operation.id,
    object: 'operation' as const,
    kind: operation.kind,
    status: operation.status,
    transaction_id: operation.requestDigest,
    end_to_end_id: operation.endToEndId ?? null,
    attempts: operation.attempts,
    last_error: operation.lastError ? JSON.stringify(operation.lastError) : null,
    created_at: operation.createdAt.toISOString(),
    updated_at: operation.updatedAt.toISOString(),
  };
}
