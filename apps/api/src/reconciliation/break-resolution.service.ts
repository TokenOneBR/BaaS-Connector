import {
  ActorType,
  BaasError,
  BaasErrorCode,
  BreakStatus,
  BreakType,
  ResolutionAction,
  TransactionStatus,
  type Clock,
  type Environment,
} from '@baasconn/taxonomy';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { ACCOUNT_REPOSITORY, type AccountRepository } from '../accounts/accounts.types.js';
import { CACHE_STORE, accountTag, type CacheStore } from '../cache/cache.types.js';
import { CLOCK } from '../common/clock.js';
import { AUDIT_REPOSITORY, type AuditRepository } from '../events/outbox.types.js';
import { ShadowLedgerService } from '../ledger/shadow-ledger.service.js';
import { TRANSACTION_REPOSITORY, type TransactionRepository } from '../pix/pix.types.js';

import {
  RECONCILIATION_BREAK_REPOSITORY,
  RECONCILIATION_RUN_REPOSITORY,
  type ReconciliationBreakRecord,
  type ReconciliationBreakRepository,
  type ReconciliationRunRepository,
} from './reconciliation.types.js';

export interface ResolveBreakInput {
  environment: Environment;
  breakId: string;
  action: ResolutionAction;
  note: string;
  resolvedBy: string;
  /** Só para `ESCALATE_TO_PROVIDER`. */
  assignTo?: string;
}

/**
 * Resolucao manual de quebra.
 *
 * APENAS ANEXA. A correcao de um erro de dinheiro e sempre um lancamento NOVO
 * e balanceado, nunca uma edicao do lancamento errado — e isso nao depende de
 * disciplina do autor: `ledger_entry_no_mutation` e o `REVOKE` das colunas de
 * contador recusam qualquer outra coisa no banco.
 */
@Injectable()
export class BreakResolutionService {
  private readonly logger = new Logger(BreakResolutionService.name);

  constructor(
    private readonly ledger: ShadowLedgerService,
    @Inject(RECONCILIATION_BREAK_REPOSITORY) private readonly breaks: ReconciliationBreakRepository,
    @Inject(RECONCILIATION_RUN_REPOSITORY) private readonly runs: ReconciliationRunRepository,
    @Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository,
    @Inject(TRANSACTION_REPOSITORY) private readonly transactions: TransactionRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    @Inject(CACHE_STORE) private readonly cache: CacheStore,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async resolve(input: ResolveBreakInput): Promise<ReconciliationBreakRecord> {
    const quebra = await this.breaks.findById(input.environment, input.breakId);
    if (!quebra) {
      throw new BaasError(BaasErrorCode.RESOURCE_NOT_FOUND, {
        message: `Quebra ${input.breakId} nao encontrada.`,
      });
    }

    if (quebra.status === BreakStatus.RESOLVED || quebra.status === BreakStatus.WRITTEN_OFF) {
      // Ja fechada. Recusar em vez de reaplicar e o que impede um duplo clique
      // de virar um segundo efeito de dominio — a idempotencia do razao cobre
      // o lancamento, mas nao cobriria uma segunda mudanca de status.
      throw new BaasError(BaasErrorCode.RESOURCE_ALREADY_EXISTS, {
        message: `Quebra ${quebra.id} ja esta ${quebra.status}; resolver de novo nao teria efeito.`,
      });
    }

    const efeito = await this.applyAction(input, quebra);

    const resolvida = await this.breaks.resolveManually({
      environment: input.environment,
      id: quebra.id,
      status: efeito.status,
      resolution: input.action,
      note: input.note,
      resolvedBy: input.resolvedBy,
      adjustmentTransactionId: efeito.adjustmentTransactionId,
      assignedTo: efeito.assignedTo,
      at: this.clock.now(),
    });

    await this.audit.record({
      environment: input.environment,
      actorType: ActorType.USER,
      actorId: input.resolvedBy,
      action: `reconciliation.break.${input.action.toLowerCase()}`,
      resourceType: 'reconciliation_break',
      resourceId: quebra.id,
      connectionId: quebra.connectionId,
      outcome: 'SUCCESS',
      before: { status: quebra.status, resolution: quebra.resolution ?? null },
      after: {
        status: efeito.status,
        resolution: input.action,
        adjustment_transaction_id: efeito.adjustmentTransactionId ?? null,
      },
      changedFields: ['status', 'resolution'],
      occurredAt: this.clock.now(),
    });

    if (quebra.accountId) {
      await this.cache.invalidateTag(accountTag(input.environment, quebra.accountId));
    }

    return resolvida ?? quebra;
  }

  private async applyAction(
    input: ResolveBreakInput,
    quebra: ReconciliationBreakRecord,
  ): Promise<{ status: BreakStatus; adjustmentTransactionId?: string; assignedTo?: string }> {
    switch (input.action) {
      case ResolutionAction.CREATE_LEDGER_ADJUSTMENT:
        return {
          status: BreakStatus.RESOLVED,
          adjustmentTransactionId: await this.postAdjustment(input, quebra),
        };

      case ResolutionAction.CANCEL_LOCAL_RECORD:
        await this.cancelLocalRecord(input, quebra);
        return { status: BreakStatus.RESOLVED };

      case ResolutionAction.ESCALATE_TO_PROVIDER:
        // Nao fecha: escalar e dizer "ainda estamos nisto".
        return { status: BreakStatus.INVESTIGATING, assignedTo: input.assignTo };

      case ResolutionAction.WRITE_OFF:
        // O operador dizendo "conhecido e aceito". Uma reincidencia NAO a
        // reabre — o upsert preserva `WRITTEN_OFF` de proposito.
        return { status: BreakStatus.WRITTEN_OFF };

      case ResolutionAction.IMPORT_FROM_PROVIDER:
      case ResolutionAction.MARK_PROVIDER_AUTHORITATIVE:
        // O operador esta fazendo a mao o que o motor recusou fazer sozinho —
        // por ambiguidade, ou porque a quebra e de um tipo que nunca
        // auto-resolve. O efeito de dominio e do worker, que tem o provedor
        // resolvido; aqui a quebra so e marcada e a auditoria registra quem
        // mandou. A execucao chega pela proxima passada da conciliacao.
        return { status: BreakStatus.RESOLVED };

      case ResolutionAction.MERGE_DUPLICATE:
      case ResolutionAction.IGNORE_TIMING_DIFFERENCE:
        return { status: BreakStatus.RESOLVED };

      default:
        throw new BaasError(BaasErrorCode.VALIDATION_ERROR, {
          message: `Acao de resolucao desconhecida: ${String(input.action)}`,
        });
    }
  }

  /**
   * O unico caminho em que um clique de operador move dinheiro.
   *
   * A chave de idempotencia e da QUEBRA, nao do clique: duplo clique, retry de
   * rede ou dois operadores na mesma quebra postam UMA vez, porque o motor do
   * razao resolve por `findByIdempotencyKey` antes de lancar. E o que impede o
   * conserto de um erro de dinheiro de virar um segundo erro de dinheiro.
   */
  private async postAdjustment(
    input: ResolveBreakInput,
    quebra: ReconciliationBreakRecord,
  ): Promise<string> {
    const delta = await this.signedDelta(quebra);
    if (!quebra.accountId || delta === 0n) {
      throw new BaasError(BaasErrorCode.VALIDATION_ERROR, {
        message: 'Quebra sem conta ou sem valor nao pode gerar ajuste de razao.',
      });
    }

    const account = await this.accounts.findById(input.environment, quebra.accountId);
    if (!account?.ledgerAvailableAccountId) {
      throw new BaasError(BaasErrorCode.VALIDATION_ERROR, {
        message: 'Conta sem razao sombra aberto.',
      });
    }

    const posted = await this.ledger.adjust({
      environment: input.environment,
      availableId: account.ledgerAvailableAccountId,
      amountCents: delta < 0n ? -delta : delta,
      direction: delta > 0n ? 'CREDIT' : 'DEBIT',
      idempotencyKey: `recon-adjust:${quebra.id}`,
      externalRef: quebra.id,
    });

    this.logger.warn(
      {
        break_id: quebra.id,
        transaction_id: posted.transaction.id,
        replayed: posted.replayed,
        resolved_by: input.resolvedBy,
      },
      'Ajuste de razao lancado por resolucao manual',
    );

    return posted.transaction.id;
  }

  /**
   * Quanto e para que lado, do ponto de vista do CLIENTE.
   *
   * Positivo credita, negativo debita. E a decisao mais perigosa deste
   * servico, entao ela e explicita:
   *
   * `deltaCents` ja e assinado — `provedor - nos` — e quando existe manda. O
   * `amountCents` NAO e assinado: e a magnitude do movimento, e usa-lo como se
   * fosse delta inverte o sentido em toda quebra de ausencia. Um PIX de
   * entrada que o provedor nunca teve seria CREDITADO de novo em vez de
   * estornado — o ajuste dobraria o erro que veio consertar.
   *
   * Sem delta assinado, o sentido vem do ITEM que originou a quebra:
   *
   *   - falta no provedor -> o item e NOSSO, e o espelho e que esta errado:
   *     desfazemos o movimento (credito local vira debito, e vice-versa);
   *   - falta em nos ou no razao -> o item e do PROVEDOR, que e o sistema de
   *     registro: aplicamos o movimento no sentido dele.
   *
   * Qualquer outro tipo recusa: um `AMOUNT_MISMATCH` sem `deltaCents` nao diz
   * de quanto e a diferenca, e adivinhar seria lancar um numero inventado.
   */
  private async signedDelta(quebra: ReconciliationBreakRecord): Promise<bigint> {
    if (quebra.deltaCents !== undefined && quebra.deltaCents !== 0n) return quebra.deltaCents;

    const desfazerLocal = quebra.type === BreakType.MISSING_ON_PROVIDER;
    const itemId = desfazerLocal
      ? quebra.localItemId
      : (quebra.providerItemId ?? quebra.ledgerItemId);

    if (
      !itemId ||
      (!desfazerLocal &&
        quebra.type !== BreakType.MISSING_ON_LOCAL &&
        quebra.type !== BreakType.MISSING_ON_LEDGER)
    ) {
      throw new BaasError(BaasErrorCode.VALIDATION_ERROR, {
        message: `Quebra ${quebra.type} sem delta assinado nao determina o sentido do ajuste.`,
      });
    }

    const item = await this.runs.findItemById(itemId);
    if (!item) {
      throw new BaasError(BaasErrorCode.VALIDATION_ERROR, {
        message: 'Item de origem da quebra nao encontrado.',
      });
    }

    const aoCliente = item.direction === 'CREDIT';
    const sentido = desfazerLocal ? !aoCliente : aoCliente;
    return sentido ? item.amountCents : -item.amountCents;
  }

  /** Cancela o registro local de um pagamento que o provedor nunca teve. */
  private async cancelLocalRecord(
    input: ResolveBreakInput,
    quebra: ReconciliationBreakRecord,
  ): Promise<void> {
    if (!quebra.localItemId) {
      throw new BaasError(BaasErrorCode.VALIDATION_ERROR, {
        message: 'Quebra sem registro local para cancelar.',
      });
    }

    // `localItemId` e id de ITEM de conciliacao, nao de transacao. No lado
    // LOCAL o `externalId` do item E o id da transacao — e por ele que se
    // chega ao registro que o operador quer cancelar.
    const item = await this.runs.findItemById(quebra.localItemId);
    const transactionId = item?.externalId;
    if (!transactionId) {
      throw new BaasError(BaasErrorCode.VALIDATION_ERROR, {
        message: 'Item local da quebra nao aponta para uma transacao.',
      });
    }

    const result = await this.transactions.applyStatusChange({
      environment: input.environment,
      transactionId,
      toStatus: TransactionStatus.CANCELLED,
      occurredAt: this.clock.now(),
      source: 'RECONCILIATION',
    });

    // Transicao ilegal devolve 422 em vez de forcar: uma transacao ja
    // liquidada nao vira cancelada por decisao de painel — isso e um ajuste
    // de razao, que e outra acao.
    if (!result.applied) {
      throw new BaasError(BaasErrorCode.VALIDATION_ERROR, {
        message: `Nao e possivel cancelar a transacao (${result.reason ?? 'desconhecido'}).`,
        meta: { current_status: result.currentStatus ?? null },
      });
    }
  }
}
