import { Metrics } from '@baasconn/observability';
import type { CanonicalEventDraft } from '@baasconn/provider-spi';
import {
  ActorType,
  AccountStatus,
  EventType,
  OnboardingStatus,
  RequirementCode,
  type Clock,
} from '@baasconn/taxonomy';
import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  ACCOUNT_REPOSITORY,
  ONBOARDING_REPOSITORY,
  type AccountRepository,
  type OnboardingRepository,
  type StatusChangeRejection,
} from '../accounts/accounts.types.js';
import { CLOCK } from '../common/clock.js';
import { KeyedMutex } from '../events/keyed-mutex.js';
import {
  AUDIT_REPOSITORY,
  OUTBOX_REPOSITORY,
  type AuditRepository,
  type OutboxRepository,
} from '../events/outbox.types.js';
import { ProviderResolver } from '../providers/provider.resolver.js';

import {
  INBOUND_EVENT_REPOSITORY,
  type InboundEventRecord,
  type InboundEventRepository,
} from './webhooks.types.js';

/**
 * Desfecho de um rascunho.
 *
 * `recorded` significa "nao aplicado, mas o motivo JA foi registrado" — a
 * distincao existe para o registro especifico nao ser sobrescrito por um
 * generico no fim do processamento.
 */
type DraftOutcome = 'applied' | 'recorded' | 'ignored';

/** Tentativas antes de mandar para a dead-letter. */
const MAX_ATTEMPTS = 2;

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
  private readonly mutex = new KeyedMutex();

  constructor(
    private readonly providers: ProviderResolver,
    private readonly metrics: Metrics,
    @Inject(INBOUND_EVENT_REPOSITORY) private readonly events: InboundEventRepository,
    @Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository,
    @Inject(ONBOARDING_REPOSITORY) private readonly cases: OnboardingRepository,
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

      const outcomes: DraftOutcome[] = [];
      for (const draft of drafts) {
        const key = `${draft.subject.kind}:${draft.subject.providerId}`;
        // FIFO por agregado, paralelo entre agregados: e o que impede
        // `pix_out.settled` de ser aplicado antes de `pix_out.pending`.
        outcomes.push(
          await this.mutex.runExclusive(key, () => this.applyDraft(event, bound.slug, draft)),
        );
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

  private async applyDraft(
    event: InboundEventRecord,
    provider: string,
    draft: CanonicalEventDraft,
  ): Promise<DraftOutcome> {
    switch (draft.subject.kind) {
      case 'account':
        return this.applyAccount(event, provider, draft);
      case 'onboarding':
        return this.applyOnboarding(event, provider, draft);
      default:
        // Transacao e cobranca entram no marco dos fluxos de dinheiro. Ate la,
        // o evento fica registrado e nao aplicado — visivel, nao perdido.
        return 'ignored';
    }
  }

  private async applyAccount(
    event: InboundEventRecord,
    provider: string,
    draft: CanonicalEventDraft,
  ): Promise<DraftOutcome> {
    const account = await this.accounts.findByProviderAccountId(
      event.environment,
      provider,
      draft.subject.providerId,
    );
    if (!account) return 'ignored';

    const incoming = draft.transitionTo as AccountStatus;
    const occurredAt = draft.occurredAt ? new Date(draft.occurredAt) : event.receivedAt;

    const result = await this.accounts.applyStatusChange({
      environment: event.environment,
      accountId: account.id,
      toStatus: incoming,
      occurredAt,
      source: 'PROVIDER_WEBHOOK',
      providerEventId: event.providerEventId ?? undefined,
      withinTransaction: async (accountId) => {
        await this.outbox.append({
          environment: event.environment,
          type: draft.type as EventType,
          provider,
          connectionId: event.connectionId,
          subjectKind: 'account',
          subjectId: accountId,
          payload: { status: incoming },
          previous: { status: account.status },
          occurredAt,
        });
        await this.audit.record({
          environment: event.environment,
          actorType: ActorType.PROVIDER,
          actorId: provider,
          action: 'account.status_changed',
          outcome: 'SUCCESS',
          resourceType: 'account',
          resourceId: accountId,
          connectionId: event.connectionId,
          provider,
          before: { status: account.status },
          after: { status: incoming },
          changedFields: ['status'],
          occurredAt,
        });
      },
    });

    if (!result.applied) {
      await this.handleRejection(event, provider, 'account', account.id, {
        reason: result.reason,
        from: result.currentStatus ?? account.status,
        to: incoming,
      });
      return 'recorded';
    }

    return 'applied';
  }

  private async applyOnboarding(
    event: InboundEventRecord,
    provider: string,
    draft: CanonicalEventDraft,
  ): Promise<DraftOutcome> {
    const data = draft.data as {
      providerAccountId?: string;
      status?: string;
      rejectionCode?: string;
      pendingRequirements?: string[];
    };

    const record = await this.findCase(event, provider, draft, data.providerAccountId);
    if (!record) return 'ignored';

    const incoming = (data.status ?? draft.transitionTo) as OnboardingStatus;
    const occurredAt = draft.occurredAt ? new Date(draft.occurredAt) : event.receivedAt;

    const requirements = (data.pendingRequirements ?? [])
      .filter((code): code is keyof typeof RequirementCode => code in RequirementCode)
      .map((code) => ({ code: RequirementCode[code], label: code }));

    const result = await this.cases.applyStatusChange({
      environment: event.environment,
      caseId: record.id,
      toStatus: incoming,
      rejectionCode: data.rejectionCode,
      providerRejectionCode: data.rejectionCode,
      requirements,
      occurredAt,
      withinTransaction: async (caseId) => {
        await this.outbox.append({
          environment: event.environment,
          type: draft.type as EventType,
          provider,
          connectionId: event.connectionId,
          subjectKind: 'onboarding',
          subjectId: caseId,
          payload: { status: incoming, pending: requirements.map((r) => r.code) },
          previous: { status: record.status },
          occurredAt,
        });
        await this.audit.record({
          environment: event.environment,
          actorType: ActorType.PROVIDER,
          actorId: provider,
          action: 'onboarding.status_changed',
          outcome: 'SUCCESS',
          resourceType: 'onboarding',
          resourceId: caseId,
          connectionId: event.connectionId,
          provider,
          before: { status: record.status },
          after: { status: incoming, rejection_code: data.rejectionCode },
          changedFields: ['status'],
          occurredAt,
        });
      },
    });

    if (!result.applied) {
      await this.handleRejection(event, provider, 'onboarding', record.id, {
        reason: result.reason,
        from: result.currentStatus ?? record.status,
        to: incoming,
      });
      return 'recorded';
    }

    return 'applied';
  }

  /**
   * Acha o caso pelo id do provedor, com queda para o id da conta.
   *
   * Provedores que so enderecam o caso pela conta — o Mock Bank e um — mandam
   * o `account_id` no evento, e e por ele que chegamos ao caso.
   */
  private async findCase(
    event: InboundEventRecord,
    provider: string,
    draft: CanonicalEventDraft,
    providerAccountId?: string,
  ) {
    const byCase = await this.cases.findByProviderCaseId(
      event.environment,
      provider,
      draft.subject.providerId,
    );
    if (byCase) return byCase;

    if (!providerAccountId) return undefined;
    const account = await this.accounts.findByProviderAccountId(
      event.environment,
      provider,
      providerAccountId,
    );
    return account ? this.cases.findByAccountId(event.environment, account.id) : undefined;
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
    event: InboundEventRecord,
    provider: string,
    resourceType: string,
    resourceId: string,
    rejection: { reason?: StatusChangeRejection; from: string; to: string },
  ): Promise<void> {
    if (rejection.reason !== 'illegal_transition') {
      this.metrics.webhookDuplicates.inc({ provider });
      await this.events.markDiscarded(event.id, rejection.reason ?? 'desconhecido');
      return;
    }

    await this.recordAnomaly(event, provider, resourceType, resourceId, rejection);
  }

  private async recordAnomaly(
    event: InboundEventRecord,
    provider: string,
    resourceType: string,
    resourceId: string,
    transition: { from: string; to: string },
  ): Promise<void> {
    this.metrics.webhookEvents.inc({ provider, type: 'anomaly', outcome: 'illegal_transition' });

    await this.audit.record({
      environment: event.environment,
      actorType: ActorType.PROVIDER,
      actorId: provider,
      action: 'webhook.anomaly.illegal_transition',
      outcome: 'FAILURE',
      errorCode: 'INVALID_STATE_TRANSITION',
      resourceType,
      resourceId,
      connectionId: event.connectionId,
      provider,
      before: { status: transition.from },
      after: { status: transition.to },
      occurredAt: this.clock.now(),
    });

    await this.outbox.append({
      environment: event.environment,
      type: EventType.COMPLIANCE_ALERT_RAISED,
      provider,
      connectionId: event.connectionId,
      subjectKind: resourceType,
      subjectId: resourceId,
      payload: {
        kind: 'illegal_transition',
        from: transition.from,
        to: transition.to,
        provider_event_id: event.providerEventId,
      },
      occurredAt: this.clock.now(),
    });

    await this.events.markProcessed(event.id, this.clock.now());
    this.logger.warn(
      { provider, resource_type: resourceType, resource_id: resourceId, ...transition },
      'Transicao ilegal vinda do provedor registrada como anomalia',
    );
  }
}
