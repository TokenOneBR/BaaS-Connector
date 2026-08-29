import {
  BaasError,
  BaasErrorCode,
  ChangeSource,
  EventType,
  TransactionStatus,
  toEffectiveDate,
  type Clock,
  type Environment,
} from '@baasconn/taxonomy';
import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  ACCOUNT_REPOSITORY,
  type AccountRepository,
} from '../accounts/accounts.types.js';
import { CACHE_STORE, accountTag, type CacheStore } from '../cache/cache.types.js';
import { CLOCK } from '../common/clock.js';
import { OUTBOX_REPOSITORY, type OutboxRepository } from '../events/outbox.types.js';
import { ShadowLedgerService } from '../ledger/shadow-ledger.service.js';
import { ProviderResolver } from '../providers/provider.resolver.js';

import {
  OPERATION_REPOSITORY,
  TRANSACTION_REPOSITORY,
  type OperationRecord,
  type OperationRepository,
  type TransactionRecord,
  type TransactionRepository,
} from './pix.types.js';

export type ReconcileOutcome =
  | { resolved: true; status: TransactionStatus; transaction: TransactionRecord }
  | { resolved: false; reason: 'not_found_at_provider' | 'no_lookup_capability' | 'not_stuck' };

/**
 * Resolve operacoes de desfecho desconhecido.
 *
 * NUNCA reenvia. Um reenvio "para garantir" e como se paga duas vezes: o
 * provedor pode ter aceitado a primeira chamada e so nao ter conseguido nos
 * responder.
 *
 * Tenta, nesta ordem: consulta pela NOSSA chave de idempotencia, consulta
 * pelo E2EID, e varredura de extrato casando valor e data. A ordem e a da
 * confianca: a chave e nossa e exata; o E2EID e globalmente unico mas so
 * existe depois de PROCESSING; o extrato e o ultimo recurso e casa por
 * heuristica.
 *
 * A escada de retry e o agendamento chegam no M7, com o BullMQ. Aqui o
 * resolvedor e CHAMAVEL — pelo endpoint de operacao, pelo e2e e, no M7, pelo
 * worker.
 */
@Injectable()
export class OperationReconciler {
  private readonly logger = new Logger(OperationReconciler.name);

  constructor(
    private readonly providers: ProviderResolver,
    private readonly ledger: ShadowLedgerService,
    @Inject(OPERATION_REPOSITORY) private readonly operations: OperationRepository,
    @Inject(TRANSACTION_REPOSITORY) private readonly transactions: TransactionRepository,
    @Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Inject(CACHE_STORE) private readonly cache: CacheStore,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async resolve(environment: Environment, operationId: string): Promise<ReconcileOutcome> {
    const operation = await this.operations.findById(environment, operationId);
    if (!operation) {
      throw new BaasError(BaasErrorCode.RESOURCE_NOT_FOUND, {
        message: `Operacao ${operationId} nao encontrada.`,
      });
    }
    if (operation.status !== 'UNKNOWN' && operation.status !== 'SUBMITTED') {
      return { resolved: false, reason: 'not_stuck' };
    }

    const transaction = await this.transactions.findByIdempotencyKey(
      environment,
      operation.providerIdempotencyKey,
    );
    if (!transaction) {
      throw new BaasError(BaasErrorCode.RESOURCE_NOT_FOUND, {
        message: `Operacao ${operationId} nao tem transacao associada.`,
      });
    }

    const account = await this.accounts.findById(environment, transaction.accountId);
    if (!account?.providerAccountId) {
      return { resolved: false, reason: 'not_found_at_provider' };
    }

    const bound = await this.providers.resolve(operation.connectionId);
    const transfers = bound.adapter.pixTransfers;
    const ref = { providerAccountId: account.providerAccountId };

    await this.operations.update({
      environment,
      id: operationId,
      incrementAttempts: true,
    });

    const found =
      (await this.byIdempotencyKey(transfers, ref, operation)) ??
      (await this.byEndToEndId(transfers, ref, transaction)) ??
      (await this.byStatementScan(bound, ref, transaction));

    if (!found) {
      if (!transfers?.findByIdempotencyKey && !bound.adapter.statement) {
        return { resolved: false, reason: 'no_lookup_capability' };
      }
      // Ausente no provedor NAO conclui nada por si: pode ser atraso de
      // indexacao. A conclusao definitiva (FAILED + break de conciliacao) e
      // do worker, apos a escada inteira. Ver M7.
      return { resolved: false, reason: 'not_found_at_provider' };
    }

    return this.applyOutcome(environment, operation, transaction, found);
  }

  private async byIdempotencyKey(
    transfers: NonNullable<
      Awaited<ReturnType<ProviderResolver['resolve']>>['adapter']['pixTransfers']
    > | undefined,
    ref: { providerAccountId: string },
    operation: OperationRecord,
  ) {
    if (!transfers?.findByIdempotencyKey) return undefined;
    try {
      return (await transfers.findByIdempotencyKey(ref, operation.providerIdempotencyKey)) ?? undefined;
    } catch (error) {
      this.logger.warn(`Consulta por chave falhou em ${operation.id}: ${String(error)}`);
      return undefined;
    }
  }

  private async byEndToEndId(
    transfers: NonNullable<
      Awaited<ReturnType<ProviderResolver['resolve']>>['adapter']['pixTransfers']
    > | undefined,
    ref: { providerAccountId: string },
    transaction: TransactionRecord,
  ) {
    const providerRef = transaction.providerTransactionId ?? transaction.pix?.endToEndId;
    if (!transfers?.get || !providerRef) return undefined;
    try {
      return await transfers.get(ref, providerRef);
    } catch {
      return undefined;
    }
  }

  /**
   * Ultimo recurso: varre o extrato do dia casando valor e sentido.
   *
   * Heuristica assumida como tal — por isso vem depois das duas consultas
   * exatas. Duas transferencias do mesmo valor no mesmo dia produziriam
   * ambiguidade, e e por isso que este passe so roda quando os anteriores nao
   * acharam nada.
   */
  private async byStatementScan(
    bound: Awaited<ReturnType<ProviderResolver['resolve']>>,
    ref: { providerAccountId: string },
    transaction: TransactionRecord,
  ) {
    if (!bound.adapter.statement) return undefined;

    try {
      const day = transaction.effectiveDate;
      const page = await bound.adapter.statement.list(ref, { from: day, to: day, limit: 200 });
      const cents = transaction.amountCents.toString();

      const matches = page.data.filter(
        (entry) => entry.direction === 'debit' && entry.amount.amount === cents,
      );
      if (matches.length !== 1) return undefined;

      const entry = matches[0]!;
      return {
        providerTransactionId: entry.providerTransactionId ?? entry.providerEntryId,
        endToEndId: entry.endToEndId,
        status: TransactionStatus.SETTLED,
        direction: 'out' as const,
        amount: entry.amount,
        createdAt: entry.postedAt,
        settledAt: entry.postedAt,
      };
    } catch (error) {
      this.logger.warn(`Varredura de extrato falhou em ${transaction.id}: ${String(error)}`);
      return undefined;
    }
  }

  /**
   * Aplica o que o provedor disse.
   *
   * O hold do razao so e resolvido AQUI, quando ha resposta: liquidado vira
   * `commitPending`, falhado vira `voidPending`. Enquanto nao ha resposta, o
   * hold continua de pe — e o que impede o cliente de gastar duas vezes um
   * dinheiro que talvez ja tenha saido.
   */
  private async applyOutcome(
    environment: Environment,
    operation: OperationRecord,
    transaction: TransactionRecord,
    found: {
      providerTransactionId: string;
      endToEndId?: string;
      status: TransactionStatus;
      settledAt?: string;
      failure?: { code: string; message: string };
    },
  ): Promise<ReconcileOutcome> {
    const now = this.clock.now();
    const settled = found.status === TransactionStatus.SETTLED;
    const failed =
      found.status === TransactionStatus.FAILED || found.status === TransactionStatus.CANCELLED;

    let ledgerPostedTransactionId: string | undefined;
    if (transaction.ledgerPendingTransactionId && (settled || failed)) {
      const resolved = settled
        ? await this.ledger.settleOut(
            environment,
            transaction.ledgerPendingTransactionId,
            `pix-out-settle:${operation.id}`,
          )
        : await this.ledger.voidOut(
            environment,
            transaction.ledgerPendingTransactionId,
            `pix-out-void:${operation.id}`,
          );
      ledgerPostedTransactionId = resolved.transaction.id;
    }

    const change = await this.transactions.applyStatusChange({
      environment,
      transactionId: transaction.id,
      toStatus: found.status,
      endToEndId: found.endToEndId,
      settledAt: found.settledAt ? new Date(found.settledAt) : settled ? now : undefined,
      failureCode: found.failure ? BaasErrorCode.PROVIDER_REJECTED : undefined,
      providerFailureCode: found.failure?.code,
      failureMessage: found.failure?.message,
      ledgerPostedTransactionId,
      occurredAt: now,
      source: ChangeSource.RECONCILIATION,
      withinTransaction: async () => {
        await this.outbox.append({
          environment,
          type: settled ? EventType.PIX_OUT_SETTLED : EventType.PIX_OUT_FAILED,
          provider: transaction.provider,
          connectionId: operation.connectionId,
          subjectKind: 'transaction',
          subjectId: transaction.id,
          payload: { status: found.status, resolved_by: 'reconciliation' },
          occurredAt: now,
        });
      },
    });

    await this.operations.update({
      environment,
      id: operation.id,
      status: settled ? 'SETTLED' : failed ? 'FAILED' : 'SUBMITTED',
      providerRef: found.providerTransactionId,
      endToEndId: found.endToEndId,
    });

    await this.cache.invalidateTag(accountTag(environment, transaction.accountId));

    const record = change.record ?? transaction;
    this.logger.log(
      `Operacao ${operation.id} resolvida como ${found.status} sem reenvio ` +
        `(dia contabil ${toEffectiveDate(now)})`,
    );

    return { resolved: true, status: found.status, transaction: record };
  }
}
