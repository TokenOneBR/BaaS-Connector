import {
  AUDIT_REPOSITORY,
  CLOCK,
  OUTBOX_REPOSITORY,
  TRANSACTION_REPOSITORY,
  WebhookApplyService,
  type AccountRecord,
  type AuditRepository,
  type BoundProvider,
  type OutboxRepository,
  type ReconciliationRunRecord,
  type TransactionRepository,
} from '@baasconn/api/domain';
import type { CanonicalEventDraft, StatementEntry } from '@baasconn/provider-spi';
import type { BreakDraft } from '@baasconn/reconciliation';
import {
  ActorType,
  ChangeSource,
  EventType,
  ResolutionAction,
  type Clock,
} from '@baasconn/taxonomy';
import { Inject, Injectable, Logger } from '@nestjs/common';

export interface AutoResolutionInput {
  run: ReconciliationRunRecord;
  account: AccountRecord;
  provider: BoundProvider;
  breaks: readonly BreakDraft[];
  /** Entrada crua do provedor, por id do item — o que a importacao aplica. */
  rawByItemId: ReadonlyMap<string, StatementEntry>;
}

/**
 * Executa as intencoes de auto-resolucao que o motor propos.
 *
 * O motor decide o QUE e seguro resolver sozinho; este servico faz. A
 * separacao importa: o motor roda sem I/O e pode ser executado contra a
 * janela de ontem em producao so para VER o que ele faria.
 *
 * Toda resolucao gera linha de auditoria. Uma correcao automatica sem trilha
 * e indistinguivel de um bug que mexeu no dinheiro do cliente.
 */
@Injectable()
export class AutoResolutionService {
  private readonly logger = new Logger(AutoResolutionService.name);

  constructor(
    private readonly apply: WebhookApplyService,
    @Inject(TRANSACTION_REPOSITORY) private readonly transactions: TransactionRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async applyAll(input: AutoResolutionInput): Promise<number> {
    let resolvidas = 0;

    for (const quebra of input.breaks) {
      if (!quebra.autoResolution) continue;

      try {
        const feito = await this.applyOne(input, quebra);
        if (feito) resolvidas += 1;
      } catch (error) {
        // Uma resolucao que falha NAO derruba a execucao: a quebra fica
        // aberta, que e o desfecho seguro, e o operador a ve no painel.
        this.logger.warn(
          { err: error, run_id: input.run.id, dedupe_key: quebra.dedupeKey },
          'Auto-resolucao falhou; a quebra segue aberta',
        );
      }
    }

    return resolvidas;
  }

  private async applyOne(input: AutoResolutionInput, quebra: BreakDraft): Promise<boolean> {
    const intencao = quebra.autoResolution!;

    switch (intencao.action) {
      case ResolutionAction.IMPORT_FROM_PROVIDER:
        return this.importFromProvider(input, quebra, intencao.providerItemId);
      case ResolutionAction.MARK_PROVIDER_AUTHORITATIVE:
        return this.markProviderAuthoritative(input, quebra, intencao);
      case ResolutionAction.IGNORE_TIMING_DIFFERENCE:
        // Nao ha mudanca de dominio: a diferenca e de POSTAGEM, nao de
        // dinheiro. Registrar e o efeito inteiro.
        await this.recordAudit(input, quebra, 'reconciliation.timing_ignored');
        return true;
      default:
        return false;
    }
  }

  /**
   * Recuperacao de webhook perdido.
   *
   * A coisa de maior valor que a conciliacao faz: o provedor creditou, o
   * webhook nunca chegou, e o cliente esta sem o dinheiro no nosso lado. Vai
   * pelo MESMO `applyDrafts` do webhook — nao ha um segundo caminho de apply
   * para divergir.
   */
  private async importFromProvider(
    input: AutoResolutionInput,
    quebra: BreakDraft,
    providerItemId: string,
  ): Promise<boolean> {
    const entry = input.rawByItemId.get(providerItemId);
    if (!entry) return false;

    const draft = toInboundDraft(entry, input.account.providerAccountId!);
    const { outcomes, lockLost } = await this.apply.applyDrafts(
      {
        environment: input.run.environment,
        connectionId: input.run.connectionId,
        provider: input.provider.slug,
        source: ChangeSource.RECONCILIATION,
        receivedAt: this.clock.now(),
      },
      [draft],
    );

    // Perder o lock nao e erro: o agregado esta sendo mexido agora, e a
    // proxima execucao encontra a quebra ou nao mais.
    if (lockLost || !outcomes.includes('applied')) return false;

    await this.recordAudit(input, quebra, 'reconciliation.imported_from_provider');
    return true;
  }

  private async markProviderAuthoritative(
    input: AutoResolutionInput,
    quebra: BreakDraft,
    intencao: { localItemId: string; fromStatus: string; toStatus: string },
  ): Promise<boolean> {
    const transactionId = quebra.localItemId;
    if (!transactionId) return false;

    const now = this.clock.now();
    const result = await this.transactions.applyStatusChange({
      environment: input.run.environment,
      transactionId,
      toStatus: intencao.toStatus as never,
      occurredAt: now,
      source: ChangeSource.RECONCILIATION,
      withinTransaction: async (id) => {
        await this.outbox.append({
          environment: input.run.environment,
          type: EventType.TRANSACTION_UPDATED,
          connectionId: input.run.connectionId,
          subjectKind: 'transaction',
          subjectId: id,
          payload: { status: intencao.toStatus, resolved_by: 'reconciliation' },
          previous: { status: intencao.fromStatus },
          occurredAt: now,
        });
      },
    });

    if (!result.applied) return false;
    await this.recordAudit(input, quebra, 'reconciliation.provider_authoritative');
    return true;
  }

  private async recordAudit(
    input: AutoResolutionInput,
    quebra: BreakDraft,
    action: string,
  ): Promise<void> {
    await this.audit.record({
      environment: input.run.environment,
      actorType: ActorType.SYSTEM,
      actorId: 'worker:reconciliation',
      action,
      resourceType: 'reconciliation_break',
      resourceId: quebra.dedupeKey,
      outcome: 'SUCCESS',
      after: {
        run_id: input.run.id,
        break_type: quebra.type,
        account_id: input.run.accountId,
      },
      connectionId: input.run.connectionId,
      provider: input.provider.slug,
      occurredAt: this.clock.now(),
    });
  }
}

/**
 * Entrada de extrato -> rascunho canonico de credito recebido.
 *
 * O `subject.providerId` e o id da transacao no provedor, exatamente como o
 * webhook o traria: e o que faz o dedupe de ultimo recurso por E2EID e a
 * chave de idempotencia do razao caírem no mesmo lugar, tenha o evento vindo
 * pelo webhook ou por aqui.
 */
export function toInboundDraft(
  entry: StatementEntry,
  providerAccountId: string,
): CanonicalEventDraft {
  return {
    type: EventType.PIX_IN_RECEIVED,
    subject: {
      kind: 'transaction',
      providerId: entry.providerTransactionId ?? entry.providerEntryId,
    },
    occurredAt: entry.postedAt,
    data: {
      providerAccountId,
      direction: 'in',
      status: 'SETTLED',
      amount: entry.amount,
      endToEndId: entry.endToEndId,
      counterparty: entry.counterparty
        ? {
            name: entry.counterparty.name,
            ispb: entry.counterparty.ispb,
            branch: entry.counterparty.branch,
            accountNumber: entry.counterparty.accountNumber,
          }
        : undefined,
      settledAt: entry.postedAt,
    },
  } as CanonicalEventDraft;
}
