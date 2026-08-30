import { zListTransactionsQuery } from '@baasconn/contracts';
import { BaasError, BaasErrorCode } from '@baasconn/taxonomy';
import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { z } from 'zod';

import { ACCOUNT_REPOSITORY, type AccountRepository } from '../accounts/accounts.types.js';
import { MinRole } from '../admin/admin-session.guard.js';
import { ConsoleEnvironmentPipe, type EnvironmentQuery } from '../admin/environment.query.js';
import { Public } from '../auth/api-key.guard.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { ShadowLedgerService } from '../ledger/shadow-ledger.service.js';

import { toTransactionDto } from './pix-transfers.service.js';
import { TRANSACTION_REPOSITORY, type TransactionRepository } from './pix.types.js';
import { OPERATION_REPOSITORY, type OperationRepository } from './pix.types.js';
import { toOperationDto } from './transactions.controller.js';

/**
 * Transacoes, para o console.
 *
 * Mesma razao do controller administrativo de contas: `/v1/transactions` e
 * guardado por `@Scopes(...)` e deriva o ator de `request.apiKey`, que numa
 * sessao de console e `undefined`.
 */
@Controller('admin/v1')
@Public()
export class AdminTransactionsController {
  constructor(
    @Inject(TRANSACTION_REPOSITORY) private readonly transactions: TransactionRepository,
    @Inject(OPERATION_REPOSITORY) private readonly operations: OperationRepository,
    @Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository,
    private readonly ledger: ShadowLedgerService,
  ) {}

  @Get('transactions')
  @MinRole('VIEWER')
  async list(
    @Query(ConsoleEnvironmentPipe) env: EnvironmentQuery,
    @Query(new ZodValidationPipe(zListTransactionsQuery))
    query: z.infer<typeof zListTransactionsQuery>,
  ) {
    const page = await this.transactions.list({
      environment: env.environment,
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

  @Get('transactions/:id')
  @MinRole('VIEWER')
  async get(@Param('id') id: string, @Query(ConsoleEnvironmentPipe) env: EnvironmentQuery) {
    return toTransactionDto(await this.require(env, id));
  }

  /**
   * As pernas de partida dobrada da transacao.
   *
   * E a tela que um operador abre quando o saldo nao bate: ver o lancamento em
   * si, e nao o espelho dele. `COMPLIANCE` porque e material de auditoria.
   */
  @Get('transactions/:id/ledger')
  @MinRole('COMPLIANCE')
  async ledgerLegs(@Param('id') id: string, @Query(ConsoleEnvironmentPipe) env: EnvironmentQuery) {
    const transaction = await this.require(env, id);
    const account = await this.accounts.findById(env.environment, transaction.accountId);
    if (!account?.ledgerAvailableAccountId) return { object: 'list' as const, data: [] };

    const ledgerTransactionId =
      transaction.ledgerPostedTransactionId ?? transaction.ledgerPendingTransactionId;
    if (!ledgerTransactionId) return { object: 'list' as const, data: [] };

    // Janela do dia contabil da transacao. Buscar o razao inteiro para
    // filtrar em memoria por um id seria varrer a conta toda a cada clique.
    const dia = new Date(`${transaction.effectiveDate}T00:00:00.000Z`);
    const fim = new Date(dia.getTime() + 24 * 3_600_000);
    const movimentos = await this.ledger.movements(
      env.environment,
      account.ledgerAvailableAccountId,
      dia,
      fim,
    );

    return {
      object: 'list' as const,
      data: movimentos
        .filter((movement) => movement.transactionId === ledgerTransactionId)
        .map((movement) => ({
          ledger_transaction_id: movement.transactionId,
          entry_id: movement.entryId,
          direction: movement.direction,
          amount: { amount: movement.amountCents.toString(), currency: 'BRL', scale: 2 },
          type: movement.type,
          effective_at: movement.effectiveAt.toISOString(),
        })),
    };
  }

  @Get('operations/:id')
  @MinRole('OPERATOR')
  async operation(@Param('id') id: string, @Query(ConsoleEnvironmentPipe) env: EnvironmentQuery) {
    const operation = await this.operations.findById(env.environment, id);
    if (!operation) {
      throw new BaasError(BaasErrorCode.RESOURCE_NOT_FOUND, {
        message: `Operacao ${id} nao encontrada.`,
      });
    }
    return toOperationDto(operation);
  }

  private async require(env: EnvironmentQuery, id: string) {
    const transaction = await this.transactions.findById(env.environment, id);
    if (!transaction) {
      throw new BaasError(BaasErrorCode.RESOURCE_NOT_FOUND, {
        message: `Transacao ${id} nao encontrada em ${env.environment}.`,
      });
    }
    return transaction;
  }
}
