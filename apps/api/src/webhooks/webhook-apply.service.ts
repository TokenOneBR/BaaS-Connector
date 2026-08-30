import { Metrics } from '@baasconn/observability';
import type { CanonicalEventDraft } from '@baasconn/provider-spi';
import type { MoneyJSON } from '@baasconn/taxonomy';
import {
  ActorType,
  AccountStatus,
  EventType,
  Money,
  OnboardingStatus,
  PixChargeStatus,
  PixInitiationMethod,
  PixPurpose,
  RequirementCode,
  TransactionDirection,
  TransactionStatus,
  TransactionType,
  newId,
  toEffectiveDate,
  type Clock,
  type Environment,
} from '@baasconn/taxonomy';
import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  ACCOUNT_REPOSITORY,
  ONBOARDING_REPOSITORY,
  type AccountRepository,
  type OnboardingRepository,
  type StatusChangeRejection,
} from '../accounts/accounts.types.js';
import { CACHE_STORE, accountTag, type CacheStore } from '../cache/cache.types.js';
import { CLOCK } from '../common/clock.js';
import { AGGREGATE_LOCK, aggregateKey, type AggregateLock } from '../events/aggregate-lock.js';
import {
  AUDIT_REPOSITORY,
  EVENT_QUEUE,
  OUTBOX_REPOSITORY,
  type AuditRepository,
  type EventQueue,
  type OutboxRepository,
} from '../events/outbox.types.js';
import { ShadowLedgerService } from '../ledger/shadow-ledger.service.js';
import {
  PIX_CHARGE_REPOSITORY,
  TRANSACTION_REPOSITORY,
  type PixChargeRepository,
  type TransactionRepository,
} from '../pix/pix.types.js';
import { ProviderResolver } from '../providers/provider.resolver.js';

import { INBOUND_EVENT_REPOSITORY, type InboundEventRepository } from './webhooks.types.js';

/**
 * Desfecho de um rascunho.
 *
 * `recorded` significa "nao aplicado, mas o motivo JA foi registrado" — a
 * distincao existe para o registro especifico nao ser sobrescrito por um
 * generico no fim do processamento.
 */
type DraftOutcome = 'applied' | 'recorded' | 'ignored';

/**
 * De onde o rascunho veio, e o que fazer com o que nao e "aplicou".
 *
 * Existe porque o caminho de dominio — criar a transacao de um credito Pix,
 * lancar no razao, emitir o evento — e o MESMO para um webhook, para a
 * conciliacao e para o poller, e so a borda difere. Sem esta seam, a
 * conciliacao precisaria de uma segunda copia de `receiveInbound`, e as duas
 * divergiriam na primeira correcao.
 */
export interface ApplyContext {
  environment: Environment;
  connectionId: string;
  provider: string;
  /** Vai para `TransactionStatusChange.source`. */
  source: string;
  /** Base do `occurredAt` quando o rascunho nao traz um. */
  receivedAt: Date;
  providerEventId?: string;
  /**
   * Rascunho sem efeito porque ja era conhecido.
   *
   * O webhook marca o evento `DISCARDED` com o motivo; a conciliacao nao tem
   * evento nenhum para marcar.
   */
  onDuplicate?(reason: string): Promise<void>;
  /** Transicao ilegal, ja auditada. O webhook da o evento por processado. */
  onAnomaly?(): Promise<void>;
}

export interface ApplyDraftsResult {
  outcomes: DraftOutcome[];
  /**
   * O lock do agregado foi perdido.
   *
   * Retorno e nao excecao porque as duas origens reagem diferente: o webhook
   * reenfileira em 250 ms, a conciliacao deixa o item para a proxima
   * execucao. Lancar obrigaria as duas a tratar excecao para um desfecho que
   * nao e erro.
   */
  lockLost: boolean;
}

/** Tentativas antes de mandar para a dead-letter. */
const MAX_ATTEMPTS = 2;

/** Forma dos eventos de pagamento, comum aos quatro tipos de Pix. */
interface PaymentEventData {
  providerAccountId?: string;
  direction?: 'in' | 'out';
  status?: string;
  amount?: MoneyJSON;
  endToEndId?: string;
  returnId?: string;
  txid?: string;
  counterparty?: { name?: string; ispb?: string; branch?: string; accountNumber?: string };
  settledAt?: string;
}

/**
 * Status de cobranca do provedor para o canonico.
 *
 * Desconhecido devolve `undefined` e o chamador decide — nunca um palpite: uma
 * cobranca marcada COMPLETED por engano faz o lojista entregar a mercadoria.
 */
function toChargeStatus(raw?: string): PixChargeStatus | undefined {
  if (!raw) return undefined;
  const upper = raw.toUpperCase();
  return upper in PixChargeStatus ? (upper as PixChargeStatus) : undefined;
}

/**
 * Aplica um evento de provedor ao dominio.
 *
 * Roda FORA do caminho de requisicao. Toda a logica de parse e mapeamento vive
 * aqui e nao no handler HTTP, para que um bug de mapeamento vire uma linha
 * FAILED nossa em vez de um 500 que faz o provedor entrar em backoff.
 *
 * No marco do worker esta classe nao muda: quem muda e a implementacao de
 * `EventQueue` que a chama.
 */
@Injectable()
export class WebhookApplyService {
  private readonly logger = new Logger(WebhookApplyService.name);

  constructor(
    private readonly providers: ProviderResolver,
    private readonly metrics: Metrics,
    private readonly ledger: ShadowLedgerService,
    @Inject(INBOUND_EVENT_REPOSITORY) private readonly events: InboundEventRepository,
    @Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository,
    @Inject(ONBOARDING_REPOSITORY) private readonly cases: OnboardingRepository,
    @Inject(TRANSACTION_REPOSITORY) private readonly transactions: TransactionRepository,
    @Inject(PIX_CHARGE_REPOSITORY) private readonly charges: PixChargeRepository,
    @Inject(CACHE_STORE) private readonly cache: CacheStore,
    @Inject(AGGREGATE_LOCK) private readonly lock: AggregateLock,
    @Inject(EVENT_QUEUE) private readonly queue: EventQueue,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async apply(eventId: string): Promise<void> {
    const event = await this.events.findById(eventId);
    if (!event) return;

    // Compare-and-set: se outro consumidor ja pegou, saimos sem duplicar.
    if (!(await this.events.markProcessing(eventId))) return;

    try {
      const bound = await this.providers.resolve(event.connectionId);
      const drafts = bound.adapter.webhooks!.parse({
        rawBody: event.payload,
        headers: event.headers,
        query: {},
        receivedAt: event.receivedAt,
      });

      if (drafts.length === 0) {
        // Tipo que nao conhecemos. Nao e falha: provedores acrescentam eventos
        // sem avisar, e tratar isso como erro encheria a dead-letter de ruido.
        await this.events.markProcessed(eventId, this.clock.now());
        return;
      }

      const { outcomes, lockLost } = await this.applyDrafts(
        {
          environment: event.environment,
          connectionId: event.connectionId,
          provider: bound.slug,
          source: 'PROVIDER_WEBHOOK',
          receivedAt: event.receivedAt,
          providerEventId: event.providerEventId ?? undefined,
          onDuplicate: async (reason) => {
            await this.events.markDiscarded(eventId, reason);
          },
          onAnomaly: async () => {
            await this.events.markProcessed(eventId, this.clock.now());
          },
        },
        drafts,
      );

      if (lockLost) {
        await this.queue.enqueue({ kind: 'inbound_webhook', eventId }, { delayMs: 250 });
        // Sai sem marcar: o evento fica em PROCESSING, e o varredor — que
        // desde este marco tambem olha PROCESSING — o resgata se o
        // reenfileiramento se perder.
        return;
      }

      if (outcomes.includes('applied')) {
        await this.events.markProcessed(eventId, this.clock.now());
      } else if (!outcomes.includes('recorded')) {
        // So marca o motivo generico quando NINGUEM registrou um especifico.
        // Sobrescrever "stale_timestamp" por "nenhum rascunho aplicavel"
        // apagaria justamente a informacao que responde "por que este status
        // nao atualizou".
        await this.events.markDiscarded(eventId, 'nenhum rascunho aplicavel');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const deadLetter = event.attempts + 1 >= MAX_ATTEMPTS;

      // Duas tentativas, nao oito: repetir payload malformado por uma hora e
      // desperdicio puro e esconde o bug atras de um grafico de retry.
      await this.events.markFailed(eventId, message, deadLetter);
      this.logger.error(
        { err: error, event_id: eventId, dead_letter: deadLetter },
        'Falha ao aplicar evento de webhook',
      );
      if (!deadLetter) throw error;
    }
  }

  /**
   * Aplica rascunhos canonicos ao dominio.
   *
   * PUBLICO e sem nocao de webhook: quem chama e o `apply` daqui, a
   * conciliacao ao importar um credito que so o provedor tem, e o poller. Os
   * tres precisam do MESMO caminho — guard monotonico, lock por agregado,
   * lancamento no razao, outbox — e um segundo caminho divergiria na primeira
   * correcao feita so num deles.
   */
  async applyDrafts(
    ctx: ApplyContext,
    drafts: readonly CanonicalEventDraft[],
  ): Promise<ApplyDraftsResult> {
    const outcomes: DraftOutcome[] = [];

    for (const draft of drafts) {
      // Exclusao por agregado, paralelo entre agregados. Quem NAO consegue o
      // lock devolve em vez de esperar: o trabalho continua no Postgres,
      // perder a vez e barato, e a correcao nunca dependeu deste lock — ela
      // vem do `SELECT ... FOR UPDATE` e do guard monotonico.
      const key = aggregateKey(ctx.environment, draft.subject.kind, draft.subject.providerId);
      const held = await this.lock.run(key, () => this.applyDraft(ctx, draft));

      if (!held.acquired) return { outcomes, lockLost: true };
      outcomes.push(held.value);
    }

    return { outcomes, lockLost: false };
  }

  private async applyDraft(ctx: ApplyContext, draft: CanonicalEventDraft): Promise<DraftOutcome> {
    switch (draft.subject.kind) {
      case 'account':
        return this.applyAccount(ctx, draft);
      case 'onboarding':
        return this.applyOnboarding(ctx, draft);
      case 'transaction':
        return this.applyTransaction(ctx, draft);
      case 'charge':
        return this.applyCharge(ctx, draft);
      default:
        // Tipo de agregado que nao conhecemos: registrado, nao perdido.
        return 'ignored';
    }
  }

  private async applyAccount(ctx: ApplyContext, draft: CanonicalEventDraft): Promise<DraftOutcome> {
    const account = await this.accounts.findByProviderAccountId(
      ctx.environment,
      ctx.provider,
      draft.subject.providerId,
    );
    if (!account) return 'ignored';

    const incoming = draft.transitionTo as AccountStatus;
    const occurredAt = draft.occurredAt ? new Date(draft.occurredAt) : ctx.receivedAt;

    const result = await this.accounts.applyStatusChange({
      environment: ctx.environment,
      accountId: account.id,
      toStatus: incoming,
      occurredAt,
      source: ctx.source,
      providerEventId: ctx.providerEventId ?? undefined,
      withinTransaction: async (accountId) => {
        await this.outbox.append({
          environment: ctx.environment,
          type: draft.type as EventType,
          provider: ctx.provider,
          connectionId: ctx.connectionId,
          subjectKind: 'account',
          subjectId: accountId,
          payload: { status: incoming },
          previous: { status: account.status },
          occurredAt,
        });
        await this.audit.record({
          environment: ctx.environment,
          actorType: ActorType.PROVIDER,
          actorId: ctx.provider,
          action: 'account.status_changed',
          outcome: 'SUCCESS',
          resourceType: 'account',
          resourceId: accountId,
          connectionId: ctx.connectionId,
          provider: ctx.provider,
          before: { status: account.status },
          after: { status: incoming },
          changedFields: ['status'],
          occurredAt,
        });
      },
    });

    if (!result.applied) {
      await this.handleRejection(ctx, 'account', account.id, {
        reason: result.reason,
        from: result.currentStatus ?? account.status,
        to: incoming,
      });
      return 'recorded';
    }

    return 'applied';
  }

  private async applyOnboarding(
    ctx: ApplyContext,
    draft: CanonicalEventDraft,
  ): Promise<DraftOutcome> {
    const data = draft.data as {
      providerAccountId?: string;
      status?: string;
      rejectionCode?: string;
      pendingRequirements?: string[];
    };

    const record = await this.findCase(ctx, draft, data.providerAccountId);
    if (!record) return 'ignored';

    const incoming = (data.status ?? draft.transitionTo) as OnboardingStatus;
    const occurredAt = draft.occurredAt ? new Date(draft.occurredAt) : ctx.receivedAt;

    const requirements = (data.pendingRequirements ?? [])
      .filter((code): code is keyof typeof RequirementCode => code in RequirementCode)
      .map((code) => ({ code: RequirementCode[code], label: code }));

    const result = await this.cases.applyStatusChange({
      environment: ctx.environment,
      caseId: record.id,
      toStatus: incoming,
      rejectionCode: data.rejectionCode,
      providerRejectionCode: data.rejectionCode,
      requirements,
      occurredAt,
      withinTransaction: async (caseId) => {
        await this.outbox.append({
          environment: ctx.environment,
          type: draft.type as EventType,
          provider: ctx.provider,
          connectionId: ctx.connectionId,
          subjectKind: 'onboarding',
          subjectId: caseId,
          payload: { status: incoming, pending: requirements.map((r) => r.code) },
          previous: { status: record.status },
          occurredAt,
        });
        await this.audit.record({
          environment: ctx.environment,
          actorType: ActorType.PROVIDER,
          actorId: ctx.provider,
          action: 'onboarding.status_changed',
          outcome: 'SUCCESS',
          resourceType: 'onboarding',
          resourceId: caseId,
          connectionId: ctx.connectionId,
          provider: ctx.provider,
          before: { status: record.status },
          after: { status: incoming, rejection_code: data.rejectionCode },
          changedFields: ['status'],
          occurredAt,
        });
      },
    });

    if (!result.applied) {
      await this.handleRejection(ctx, 'onboarding', record.id, {
        reason: result.reason,
        from: result.currentStatus ?? record.status,
        to: incoming,
      });
      return 'recorded';
    }

    return 'applied';
  }

  /**
   * Aplica um evento de pagamento.
   *
   * Os QUATRO eventos de Pix — saida pendente, saida liquidada, entrada
   * recebida e devolucao — compartilham este caminho porque compartilham o
   * agregado `transaction`. O `KeyedMutex` ja serializa `pending` antes de
   * `settled` para a mesma transacao, sem trabalho adicional.
   *
   * Uma transacao que NAO existe localmente e um Pix de ENTRADA: ninguem o
   * pediu, ele simplesmente chegou. E o unico caso em que o webhook cria
   * registro, e e por ele que o dinheiro que entra aparece para o cliente.
   */
  private async applyTransaction(
    ctx: ApplyContext,
    draft: CanonicalEventDraft,
  ): Promise<DraftOutcome> {
    const data = draft.data as PaymentEventData;
    const occurredAt = draft.occurredAt ? new Date(draft.occurredAt) : ctx.receivedAt;
    const incoming = (data.status ?? draft.transitionTo) as TransactionStatus;

    const existing = await this.findTransaction(ctx, draft, data);

    if (!existing) {
      if (data.direction !== 'in') {
        // Saida que nao conhecemos e anomalia, nao rotina: significa que o
        // provedor pagou algo que nao pedimos, ou que perdemos a escrita.
        this.logger.warn(
          { provider: ctx.provider, provider_transaction_id: draft.subject.providerId },
          'Evento de saida para transacao desconhecida',
        );
        return 'ignored';
      }
      return this.receiveInbound(ctx, draft, data, occurredAt);
    }

    // O E2EID quase sempre chega SO agora: e gerado pelo PSP do pagador e nao
    // existia quando gravamos a transacao.
    const settled = incoming === TransactionStatus.SETTLED;
    const failed =
      incoming === TransactionStatus.FAILED || incoming === TransactionStatus.CANCELLED;

    let ledgerPostedTransactionId: string | undefined;
    if (existing.ledgerPendingTransactionId && (settled || failed)) {
      const resolved = settled
        ? await this.ledger.settleOut(
            ctx.environment,
            existing.ledgerPendingTransactionId,
            `pix-out-settle:${existing.id}`,
          )
        : await this.ledger.voidOut(
            ctx.environment,
            existing.ledgerPendingTransactionId,
            `pix-out-void:${existing.id}`,
          );
      ledgerPostedTransactionId = resolved.transaction.id;
    }

    const result = await this.transactions.applyStatusChange({
      environment: ctx.environment,
      transactionId: existing.id,
      toStatus: incoming,
      endToEndId: data.endToEndId,
      settledAt: data.settledAt ? new Date(data.settledAt) : settled ? occurredAt : undefined,
      ledgerPostedTransactionId,
      occurredAt,
      source: ctx.source,
      providerEventId: ctx.providerEventId ?? undefined,
      withinTransaction: async (transactionId) => {
        await this.outbox.append({
          environment: ctx.environment,
          type: draft.type as EventType,
          provider: ctx.provider,
          connectionId: ctx.connectionId,
          subjectKind: 'transaction',
          subjectId: transactionId,
          payload: { status: incoming, end_to_end_id: data.endToEndId ?? null },
          previous: { status: existing.status },
          occurredAt,
        });
      },
    });

    if (!result.applied) {
      await this.handleRejection(ctx, 'transaction', existing.id, {
        reason: result.reason,
        from: result.currentStatus ?? existing.status,
        to: incoming,
      });
      return 'recorded';
    }

    await this.invalidateBalance(ctx.environment, existing.accountId);
    return 'applied';
  }

  /**
   * Registra um Pix de entrada.
   *
   * O credito no razao sombra e a gravacao da transacao acontecem juntos. Se
   * o razao falhar, nao gravamos a transacao: um extrato com um credito que o
   * razao nao conhece e exatamente o break que a conciliacao existe para
   * achar, e produzi-lo de proposito seria absurdo.
   */
  private async receiveInbound(
    ctx: ApplyContext,
    draft: CanonicalEventDraft,
    data: PaymentEventData,
    occurredAt: Date,
  ): Promise<DraftOutcome> {
    if (!data.providerAccountId) return 'ignored';

    const account = await this.accounts.findByProviderAccountId(
      ctx.environment,
      ctx.provider,
      data.providerAccountId,
    );
    if (!account?.ledgerAvailableAccountId) return 'ignored';

    // Dedupe de ultimo recurso pelo E2EID: e globalmente unico no Pix, e e o
    // que salva quando o provedor reentrega com um id de evento novo.
    if (data.endToEndId) {
      const byE2e = await this.transactions.findByEndToEndId(ctx.environment, data.endToEndId);
      if (byE2e) {
        await ctx.onDuplicate?.('e2eid ja registrado');
        return 'recorded';
      }
    }

    const amountCents = data.amount ? Money.fromJSON(data.amount).cents : 0n;
    const posted = await this.ledger.creditIn({
      environment: ctx.environment,
      availableId: account.ledgerAvailableAccountId,
      amountCents,
      idempotencyKey: `pix-in:${draft.subject.providerId}`,
      externalRef: data.endToEndId ?? draft.subject.providerId,
    });

    const isRefund = draft.type === EventType.PIX_REFUND_SETTLED;
    const transaction = await this.transactions.create({
      id: newId('transaction'),
      environment: ctx.environment,
      accountId: account.id,
      type: isRefund ? TransactionType.PIX_REFUND_IN : TransactionType.PIX_IN,
      direction: TransactionDirection.CREDIT,
      status: (data.status ?? TransactionStatus.SETTLED) as TransactionStatus,
      lastEventAt: occurredAt,
      amountCents,
      feeCents: 0n,
      netAmountCents: amountCents,
      refundedAmountCents: 0n,
      currency: 'BRL',
      description: null,
      provider: ctx.provider,
      providerConnectionId: ctx.connectionId,
      providerTransactionId: draft.subject.providerId,
      idempotencyKey: null,
      effectiveDate: toEffectiveDate(occurredAt),
      requestedAt: occurredAt,
      settledAt: data.settledAt ? new Date(data.settledAt) : occurredAt,
      ledgerPostedTransactionId: posted.transaction.id,
      pix: {
        endToEndId: data.endToEndId ?? null,
        returnId: data.returnId ?? null,
        txid: data.txid ?? null,
        initiationMethod: PixInitiationMethod.KEY,
        purpose: PixPurpose.TRANSFER,
        counterparty: data.counterparty
          ? {
              name: data.counterparty.name ?? null,
              ispb: data.counterparty.ispb ?? null,
              branch: data.counterparty.branch ?? null,
              accountNumber: data.counterparty.accountNumber ?? null,
            }
          : null,
        settlementAt: data.settledAt ? new Date(data.settledAt) : occurredAt,
      },
      metadata: {},
      createdAt: occurredAt,
      updatedAt: occurredAt,
    });

    await this.outbox.append({
      environment: ctx.environment,
      type: draft.type as EventType,
      provider: ctx.provider,
      connectionId: ctx.connectionId,
      subjectKind: 'transaction',
      subjectId: transaction.id,
      payload: {
        account_id: account.id,
        amount_cents: amountCents.toString(),
        end_to_end_id: data.endToEndId ?? null,
      },
      occurredAt,
    });

    await this.invalidateBalance(ctx.environment, account.id);
    return 'applied';
  }

  /**
   * Aplica um evento de cobranca.
   *
   * Diferente de conta e onboarding: `pix_charge.paid` NAO traz `transitionTo`,
   * e o `status` vem como texto cru do provedor. O mapeamento acontece aqui,
   * antes do guard, e o guard usa a tabela de transicao de cobranca.
   */
  private async applyCharge(ctx: ApplyContext, draft: CanonicalEventDraft): Promise<DraftOutcome> {
    const data = draft.data as {
      status?: string;
      paidAmount?: MoneyJSON;
    };

    const charge = await this.charges.findByTxid(ctx.environment, draft.subject.providerId);
    if (!charge) return 'ignored';

    const incoming = toChargeStatus(data.status) ?? PixChargeStatus.COMPLETED;
    const occurredAt = draft.occurredAt ? new Date(draft.occurredAt) : ctx.receivedAt;

    const result = await this.charges.applyStatusChange({
      environment: ctx.environment,
      txid: charge.txid,
      toStatus: incoming,
      paidAmountCents: data.paidAmount ? Money.fromJSON(data.paidAmount).cents : undefined,
      paidAt: incoming === PixChargeStatus.COMPLETED ? occurredAt : undefined,
      occurredAt,
      withinTransaction: async (chargeId) => {
        await this.outbox.append({
          environment: ctx.environment,
          type: draft.type as EventType,
          provider: ctx.provider,
          connectionId: ctx.connectionId,
          subjectKind: 'pix_charge',
          subjectId: chargeId,
          payload: { status: incoming, txid: charge.txid },
          previous: { status: charge.status },
          occurredAt,
        });
      },
    });

    if (!result.applied) {
      await this.handleRejection(ctx, 'pix_charge', charge.id, {
        reason: result.reason,
        from: result.currentStatus ?? charge.status,
        to: incoming,
      });
      return 'recorded';
    }

    return 'applied';
  }

  /**
   * Acha a transacao pelo id do provedor, com queda para o E2EID.
   *
   * A queda importa: alguns provedores mudam o proprio id entre a aceitacao e
   * a liquidacao, e o E2EID e a unica referencia estavel de ponta a ponta.
   */
  private async findTransaction(
    ctx: ApplyContext,
    draft: CanonicalEventDraft,
    data: PaymentEventData,
  ) {
    const byProvider = await this.transactions.findByProviderTransactionId(
      ctx.environment,
      ctx.provider,
      draft.subject.providerId,
    );
    if (byProvider) return byProvider;

    return data.endToEndId
      ? this.transactions.findByEndToEndId(ctx.environment, data.endToEndId)
      : undefined;
  }

  /** Invalida por TAG. `SCAN` em caminho quente degrada o Redis inteiro. */
  private async invalidateBalance(environment: Environment, accountId: string): Promise<void> {
    await this.cache.invalidateTag(accountTag(environment, accountId));
  }

  /**
   * Acha o caso pelo id do provedor, com queda para o id da conta.
   *
   * Provedores que so enderecam o caso pela conta — o Mock Bank e um — mandam
   * o `account_id` no evento, e e por ele que chegamos ao caso.
   */
  private async findCase(
    ctx: ApplyContext,
    draft: CanonicalEventDraft,
    providerAccountId?: string,
  ) {
    const byCase = await this.cases.findByProviderCaseId(
      ctx.environment,
      ctx.provider,
      draft.subject.providerId,
    );
    if (byCase) return byCase;

    if (!providerAccountId) return undefined;
    const account = await this.accounts.findByProviderAccountId(
      ctx.environment,
      ctx.provider,
      providerAccountId,
    );
    return account ? this.cases.findByAccountId(ctx.environment, account.id) : undefined;
  }

  /**
   * Decide o que fazer com uma mudanca recusada.
   *
   * Os motivos NAO sao equivalentes, e tratar todos como descarte e o erro que
   * faz saldos derivarem em silencio:
   *
   * - evento velho, duplicado ou repetido: reentrega e comportamento NORMAL de
   *   provedor. Vira DISCARDED com o motivo — registrado, porque "por que este
   *   status nao atualizou" precisa ter resposta.
   * - transicao ilegal: o provedor esta contradizendo a maquina de estados.
   *   Vira anomalia auditada e alertavel. Descartar em silencio faria o estado
   *   divergir sem ninguem saber; aplicar faria a maquina nao significar nada.
   */
  private async handleRejection(
    ctx: ApplyContext,
    resourceType: string,
    resourceId: string,
    rejection: { reason?: StatusChangeRejection; from: string; to: string },
  ): Promise<void> {
    if (rejection.reason !== 'illegal_transition') {
      this.metrics.webhookDuplicates.inc({ provider: ctx.provider });
      await ctx.onDuplicate?.(rejection.reason ?? 'desconhecido');
      return;
    }

    await this.recordAnomaly(ctx, resourceType, resourceId, rejection);
  }

  private async recordAnomaly(
    ctx: ApplyContext,
    resourceType: string,
    resourceId: string,
    transition: { from: string; to: string },
  ): Promise<void> {
    this.metrics.webhookEvents.inc({
      provider: ctx.provider,
      type: 'anomaly',
      outcome: 'illegal_transition',
    });

    await this.audit.record({
      environment: ctx.environment,
      actorType: ActorType.PROVIDER,
      actorId: ctx.provider,
      action: 'webhook.anomaly.illegal_transition',
      outcome: 'FAILURE',
      errorCode: 'INVALID_STATE_TRANSITION',
      resourceType,
      resourceId,
      connectionId: ctx.connectionId,
      provider: ctx.provider,
      before: { status: transition.from },
      after: { status: transition.to },
      occurredAt: this.clock.now(),
    });

    await this.outbox.append({
      environment: ctx.environment,
      type: EventType.COMPLIANCE_ALERT_RAISED,
      provider: ctx.provider,
      connectionId: ctx.connectionId,
      subjectKind: resourceType,
      subjectId: resourceId,
      payload: {
        kind: 'illegal_transition',
        from: transition.from,
        to: transition.to,
        provider_event_id: ctx.providerEventId,
      },
      occurredAt: this.clock.now(),
    });

    await ctx.onAnomaly?.();
    this.logger.warn(
      {
        provider: ctx.provider,
        resource_type: resourceType,
        resource_id: resourceId,
        ...transition,
      },
      'Transicao ilegal vinda do provedor registrada como anomalia',
    );
  }
}
