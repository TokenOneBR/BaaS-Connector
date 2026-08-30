import { createHash } from 'node:crypto';

import type { StatementEntryDto } from '@baasconn/contracts';
import {
  BaasError,
  BaasErrorCode,
  Money,
  StatementEntryType,
  TransactionStatus,
  TransactionType,
  type Environment,
} from '@baasconn/taxonomy';
import { Inject, Injectable } from '@nestjs/common';

import { ACCOUNT_REPOSITORY, type AccountRepository } from '../accounts/accounts.types.js';
import { ApiConfig } from '../config/config.service.js';

import { decodeCursor, encodeCursor } from './cursor.js';
import {
  TRANSACTION_REPOSITORY,
  type TransactionRecord,
  type TransactionRepository,
} from './pix.types.js';

export interface StatementRequest {
  environment: Environment;
  accountId: string;
  from: string;
  to: string;
  limit: number;
  cursor?: string;
}

@Injectable()
export class StatementService {
  constructor(
    private readonly config: ApiConfig,
    @Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository,
    @Inject(TRANSACTION_REPOSITORY) private readonly transactions: TransactionRepository,
  ) {}

  /**
   * Extrato paginado por keyset.
   *
   * O cursor carrega a posicao E o digest dos filtros. Sem o digest, mudar
   * `from`/`to` entre paginas produz um resultado que nao e nem uma consulta
   * nem a outra — e um extrato assim nao bate com nada, sem dar erro nenhum.
   */
  async list(request: StatementRequest): Promise<{
    data: StatementEntryDto[];
    nextCursor?: string;
  }> {
    const account = await this.accounts.findById(request.environment, request.accountId);
    if (!account) {
      throw new BaasError(BaasErrorCode.ACCOUNT_NOT_FOUND, {
        message: `Conta ${request.accountId} nao encontrada.`,
      });
    }

    const filters = filterDigest(request);
    const position = request.cursor ? this.decode(request.cursor, filters) : undefined;

    const page = await this.transactions.statement({
      environment: request.environment,
      accountId: request.accountId,
      from: request.from,
      to: request.to,
      statuses: [...STATEMENT_STATUSES],
      limit: request.limit,
      cursor: position,
    });

    return {
      data: page.data.map(toStatementEntry),
      nextCursor: page.nextCursor
        ? encodeCursor({ ...page.nextCursor, filters }, this.config.cursorSecret)
        : undefined,
    };
  }

  private decode(cursor: string, filters: string) {
    const decoded = decodeCursor(cursor, this.config.cursorSecret, filters);
    if (decoded.ok) return decoded.cursor;

    throw new BaasError(BaasErrorCode.INVALID_CURSOR, {
      message:
        decoded.reason === 'filters_changed'
          ? 'O cursor pertence a uma consulta com filtros diferentes. Recomece a paginacao.'
          : 'Cursor invalido ou adulterado.',
      meta: { reason: decoded.reason },
    });
  }
}

/**
 * Digest dos filtros que definem a consulta.
 *
 * `limit` fica de FORA de proposito: mudar o tamanho da pagina no meio da
 * paginacao e legitimo e nao altera o conjunto de resultados; mudar a janela
 * de datas altera.
 */
export function filterDigest(request: Pick<StatementRequest, 'accountId' | 'from' | 'to'>): string {
  return createHash('sha256')
    .update(`${request.accountId}|${request.from}|${request.to}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Transacao canonica para linha de extrato.
 *
 * Transacoes NAO liquidadas ficam de fora pelo chamador, nao aqui: um extrato
 * e o que aconteceu, e uma transferencia em voo ainda nao aconteceu.
 */
export function toStatementEntry(record: TransactionRecord): StatementEntryDto {
  return {
    id: record.id,
    posted_at: (record.settledAt ?? record.createdAt).toISOString(),
    effective_date: record.effectiveDate,
    direction: record.direction,
    amount: Money.of(record.amountCents).toJSON(),
    balance_after: null,
    type: statementTypeOf(record),
    end_to_end_id: record.pix?.endToEndId ?? null,
    transaction_id: record.id,
    counterparty_name: record.pix?.counterparty?.name ?? null,
    description: record.description ?? null,
  };
}

function statementTypeOf(record: TransactionRecord): StatementEntryType {
  switch (record.type) {
    case TransactionType.PIX_IN:
      return StatementEntryType.PIX_IN;
    case TransactionType.PIX_OUT:
      return StatementEntryType.PIX_OUT;
    case TransactionType.PIX_REFUND_IN:
    case TransactionType.PIX_REFUND_OUT:
      return StatementEntryType.REFUND;
    case TransactionType.FEE:
    case TransactionType.FEE_REVERSAL:
      return StatementEntryType.FEE;
    case TransactionType.ADJUSTMENT_CREDIT:
    case TransactionType.ADJUSTMENT_DEBIT:
      return StatementEntryType.ADJUSTMENT;
    default:
      return StatementEntryType.OTHER;
  }
}

/** Estados que ja aconteceram e por isso pertencem ao extrato. */
export const STATEMENT_STATUSES: ReadonlySet<TransactionStatus> = new Set([
  TransactionStatus.SETTLED,
  TransactionStatus.REVERSED,
  TransactionStatus.PARTIALLY_REVERSED,
]);
