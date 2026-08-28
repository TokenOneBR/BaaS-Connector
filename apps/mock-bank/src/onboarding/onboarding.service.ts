import { HolderType, newId, OnboardingStatus, RequirementCode } from '@baasconn/taxonomy';
import { Injectable } from '@nestjs/common';

import { AccountsService } from '../accounts/accounts.service.js';
import { MockClock } from '../common/clock.provider.js';
import { MockBankError } from '../common/errors.js';
import {
  describeOnboardingScenario,
  OnboardingScenario,
  onboardingScenarioFor,
} from '../common/magic-values.js';
import { MockBankStore, MockOnboarding } from '../common/store.js';
import { MockBankConfig } from '../config/config.service.js';
import { WebhookService } from '../webhooks/webhook.service.js';

/**
 * Maquina de onboarding do Mock Bank.
 *
 * O comportamento e funcao pura do documento, via valores magicos. Isso e o
 * que torna a suite e2e legivel e sem estado compartilhado: "CNPJ terminado em
 * 01" ja diz que vai pedir selfie e comprovante.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly store: MockBankStore,
    private readonly accounts: AccountsService,
    private readonly clock: MockClock,
    private readonly config: MockBankConfig,
    private readonly webhooks: WebhookService,
  ) {}

  submit(accountId: string): MockOnboarding {
    const account = this.accounts.get(accountId);

    const existing = account.onboardingId
      ? this.store.onboardings.get(account.onboardingId)
      : undefined;
    if (existing) return existing;

    const scenario = onboardingScenarioFor(account.holderTaxId);
    const outcome = describeOnboardingScenario(scenario);
    const now = this.clock.now();

    const onboarding: MockOnboarding = {
      id: newId('onboarding'),
      accountId,
      type: account.holderType === HolderType.BUSINESS ? 'KYB' : 'KYC',
      status: OnboardingStatus.SUBMITTED,
      requirements: outcome.requirements.map((code) => ({ code, status: 'PENDING' as const })),
      screenings: outcome.screenings.map((s) => ({
        type: s.type,
        result: s.matched ? ('MATCH' as const) : ('CLEAR' as const),
      })),
      scenario,
      submittedAt: now,
      updatedAt: now,
      expiresAt: outcome.expiresInSeconds
        ? new Date(now.getTime() + outcome.expiresInSeconds * 1000)
        : undefined,
    };

    this.store.onboardings.set(onboarding.id, onboarding);
    account.onboardingId = onboarding.id;

    void this.advance(onboarding.id, scenario);
    return onboarding;
  }

  get(id: string): MockOnboarding {
    const onboarding = this.store.onboardings.get(id);
    if (!onboarding) {
      throw new MockBankError('MB-ONB-404', `Onboarding ${id} nao encontrado.`, 404 as never);
    }
    this.expireIfDue(onboarding);
    return onboarding;
  }

  byAccount(accountId: string): MockOnboarding | undefined {
    const account = this.accounts.get(accountId);
    return account.onboardingId ? this.get(account.onboardingId) : undefined;
  }

  /** Envia um documento e, se foi o ultimo pendente, aprova. */
  submitDocument(onboardingId: string, code: RequirementCode): MockOnboarding {
    const onboarding = this.get(onboardingId);
    const requirement = onboarding.requirements.find((r) => r.code === code);
    if (!requirement) {
      throw new MockBankError(
        'MB-ONB-422',
        `Pendencia ${code} nao existe neste caso.`,
        422 as never,
      );
    }

    requirement.status = 'ACCEPTED';
    requirement.documentId = newId('document');
    onboarding.updatedAt = this.clock.now();

    const allDone = onboarding.requirements.every((r) => r.status === 'ACCEPTED');
    if (allDone) void this.approve(onboarding, false);
    else void this.emitStatus(onboarding);

    return onboarding;
  }

  /** Forca uma decisao. Usado pelo painel de controle e pelos testes. */
  forceDecision(
    onboardingId: string,
    decision: 'APPROVE' | 'REJECT' | 'PENDING',
    reason?: string,
  ): MockOnboarding {
    const onboarding = this.get(onboardingId);
    if (decision === 'APPROVE') void this.approve(onboarding, false);
    else if (decision === 'REJECT')
      void this.reject(onboarding, 'MB-ONB-FORCED', reason ?? 'Recusa forcada');
    else {
      onboarding.status = OnboardingStatus.PENDING_REQUIREMENTS;
      onboarding.updatedAt = this.clock.now();
      void this.emitStatus(onboarding);
    }
    return onboarding;
  }

  /** Executa o desfecho do cenario, com o atraso configurado. */
  private async advance(onboardingId: string, scenario: OnboardingScenario): Promise<void> {
    const onboarding = this.store.onboardings.get(onboardingId);
    if (!onboarding) return;
    const outcome = describeOnboardingScenario(scenario);

    switch (scenario) {
      case OnboardingScenario.REJECT_DATA_MISMATCH:
      case OnboardingScenario.SANCTIONS_MATCH:
        await this.reject(
          onboarding,
          outcome.rejectionCode ?? 'PROVIDER_POLICY',
          'Recusado na analise automatica',
        );
        return;

      case OnboardingScenario.PENDING_DOCUMENTS:
      case OnboardingScenario.EXPIRES:
        onboarding.status = OnboardingStatus.PENDING_REQUIREMENTS;
        onboarding.updatedAt = this.clock.now();
        await this.emitStatus(onboarding);
        return;

      case OnboardingScenario.PEP_MATCH:
      case OnboardingScenario.MANUAL_REVIEW:
        onboarding.status = OnboardingStatus.MANUAL_REVIEW;
        onboarding.updatedAt = this.clock.now();
        await this.emitStatus(onboarding);
        if (scenario === OnboardingScenario.MANUAL_REVIEW) {
          await this.sleep(this.config.isCi ? 0 : this.config.reviewDelayMs);
          await this.approve(onboarding, false);
        }
        return;

      case OnboardingScenario.APPROVE_BLOCKED:
        await this.sleep(this.config.isCi ? 0 : this.config.approvalDelayMs);
        await this.approve(onboarding, true);
        return;

      case OnboardingScenario.APPROVE:
        await this.sleep(this.config.isCi ? 0 : this.config.approvalDelayMs);
        await this.approve(onboarding, false);
        return;
    }
  }

  private async approve(onboarding: MockOnboarding, openBlocked: boolean): Promise<void> {
    if (onboarding.status === OnboardingStatus.APPROVED) return;
    onboarding.status = OnboardingStatus.APPROVED;
    onboarding.decidedAt = this.clock.now();
    onboarding.updatedAt = onboarding.decidedAt;

    const scenario = onboarding.scenario as OnboardingScenario;
    const shouldBlock = openBlocked || describeOnboardingScenario(scenario).openBlocked;
    const account = this.accounts.activate(onboarding.accountId, shouldBlock);

    await this.emitStatus(onboarding);
    await this.webhooks.emit(account.clientId, 'account.status_changed', {
      account_id: account.id,
      status: account.status,
    });
  }

  private async reject(onboarding: MockOnboarding, code: string, message: string): Promise<void> {
    onboarding.status = OnboardingStatus.REJECTED;
    onboarding.rejectionCode = code;
    onboarding.rejectionMessage = message;
    onboarding.decidedAt = this.clock.now();
    onboarding.updatedAt = onboarding.decidedAt;
    this.accounts.reject(onboarding.accountId);
    await this.emitStatus(onboarding);
  }

  /** Expira quando o prazo passou, respeitando o relogio logico. */
  private expireIfDue(onboarding: MockOnboarding): void {
    if (!onboarding.expiresAt) return;
    if (onboarding.status !== OnboardingStatus.PENDING_REQUIREMENTS) return;
    if (this.clock.now() < onboarding.expiresAt) return;

    onboarding.status = OnboardingStatus.EXPIRED;
    onboarding.updatedAt = this.clock.now();
    void this.emitStatus(onboarding);
  }

  private async emitStatus(onboarding: MockOnboarding): Promise<void> {
    const account = this.accounts.get(onboarding.accountId);
    await this.webhooks.emit(account.clientId, 'onboarding.status_changed', {
      onboarding_id: onboarding.id,
      account_id: onboarding.accountId,
      status: onboarding.status,
      rejection_code: onboarding.rejectionCode,
      pending_requirements: onboarding.requirements
        .filter((r) => r.status === 'PENDING')
        .map((r) => r.code),
    });
  }

  private sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
