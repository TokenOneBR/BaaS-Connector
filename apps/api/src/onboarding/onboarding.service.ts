import type { DocumentUpload } from '@baasconn/provider-spi';
import {
  ActorType,
  BaasError,
  BaasErrorCode,
  EventType,
  RequirementStatus,
  newId,
  type Clock,
  type Environment,
} from '@baasconn/taxonomy';
import { Inject, Injectable } from '@nestjs/common';

import type { ActorContext } from '../accounts/accounts.service.js';
import {
  ACCOUNT_REPOSITORY,
  ONBOARDING_REPOSITORY,
  type AccountRepository,
  type OnboardingRecord,
  type OnboardingRepository,
} from '../accounts/accounts.types.js';
import { CLOCK } from '../common/clock.js';
import {
  AUDIT_REPOSITORY,
  OUTBOX_REPOSITORY,
  type AuditRepository,
  type OutboxRepository,
} from '../events/outbox.types.js';
import { ProviderResolver } from '../providers/provider.resolver.js';

@Injectable()
export class OnboardingService {
  constructor(
    private readonly providers: ProviderResolver,
    @Inject(ONBOARDING_REPOSITORY) private readonly cases: OnboardingRepository,
    @Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async statusOf(actor: ActorContext, accountId: string) {
    const record = await this.cases.findByAccountId(actor.environment, accountId);
    if (!record) {
      throw new BaasError(BaasErrorCode.RESOURCE_NOT_FOUND, {
        message: `A conta ${accountId} nao possui caso de onboarding.`,
      });
    }
    return toOnboardingDto(record);
  }

  async byId(environment: Environment, caseId: string): Promise<OnboardingRecord> {
    const record = await this.cases.findById(environment, caseId);
    if (!record) {
      throw new BaasError(BaasErrorCode.RESOURCE_NOT_FOUND, {
        message: `Caso de onboarding ${caseId} nao encontrado.`,
      });
    }
    return record;
  }

  /**
   * Envia um documento ao provedor e reflete o caso.
   *
   * O estado do caso NAO e deduzido localmente a partir do envio: relemos o
   * caso no provedor logo depois. Deduzir significaria manter duas maquinas de
   * estado — a nossa e a dele — e elas divergem no primeiro documento que ele
   * recusa por qualidade de imagem.
   */
  async uploadDocument(actor: ActorContext, caseId: string, document: DocumentUpload) {
    const record = await this.byId(actor.environment, caseId);
    if (!record.providerCaseId) {
      throw new BaasError(BaasErrorCode.RESOURCE_NOT_FOUND, {
        message: 'O caso ainda nao foi espelhado no provedor.',
      });
    }

    const bound = await this.providers.require(actor.connectionId, 'onboarding.document.upload', {
      operationId: actor.operationId,
    });

    const receipt = await bound.adapter.onboarding!.uploadDocument(record.providerCaseId, document);

    const refreshed = await bound.adapter.onboarding!.getStatus(record.providerCaseId);
    const now = this.clock.now();

    const applied = await this.cases.applyStatusChange({
      environment: actor.environment,
      caseId: record.id,
      toStatus: refreshed.status,
      rejectionCode: refreshed.decision?.reasonCode,
      rejectionMessage: refreshed.decision?.reason,
      providerRejectionCode: refreshed.decision?.providerReasonCode,
      requirements: refreshed.pendingRequirements.map((requirement) => ({
        code: requirement.code,
        label: requirement.description,
      })),
      occurredAt: now,
      withinTransaction: async (id) => {
        await this.outbox.append({
          environment: actor.environment,
          type: EventType.ONBOARDING_REQUIREMENTS_UPDATED,
          provider: bound.slug,
          connectionId: actor.connectionId,
          subjectKind: 'onboarding',
          subjectId: id,
          payload: {
            status: refreshed.status,
            document_id: receipt.providerDocumentId,
            pending: refreshed.pendingRequirements.map((r) => r.code),
          },
          occurredAt: now,
        });
      },
    });

    await this.audit.record({
      environment: actor.environment,
      actorType: ActorType.API_KEY,
      actorId: actor.apiKeyId,
      actorIp: actor.ip,
      action: 'onboarding.document.upload',
      outcome: 'SUCCESS',
      resourceType: 'onboarding',
      resourceId: record.id,
      connectionId: actor.connectionId,
      provider: bound.slug,
      // Metadados apenas: o conteudo do documento nunca entra na trilha.
      after: {
        code: document.kind,
        sha256: document.sha256,
        size_bytes: document.sizeBytes,
        provider_document_id: receipt.providerDocumentId,
      },
      requestId: actor.requestId,
      occurredAt: now,
    });

    return {
      document_id: newId('document'),
      provider_document_id: receipt.providerDocumentId,
      code: document.kind,
      sha256: document.sha256,
      size_bytes: document.sizeBytes,
      onboarding: toOnboardingDto(applied.record ?? record),
    };
  }

  async fulfill(actor: ActorContext, caseId: string, code: string) {
    const record = await this.byId(actor.environment, caseId);
    if (!record.providerCaseId) {
      throw new BaasError(BaasErrorCode.RESOURCE_NOT_FOUND, {
        message: 'O caso ainda nao foi espelhado no provedor.',
      });
    }

    const bound = await this.providers.require(
      actor.connectionId,
      'onboarding.requirements.fulfill',
      { operationId: actor.operationId },
    );
    const refreshed = await bound.adapter.onboarding!.fulfillRequirement(record.providerCaseId, {
      code,
    });

    const applied = await this.cases.applyStatusChange({
      environment: actor.environment,
      caseId: record.id,
      toStatus: refreshed.status,
      requirements: refreshed.pendingRequirements.map((requirement) => ({
        code: requirement.code,
        label: requirement.description,
      })),
      occurredAt: this.clock.now(),
    });

    return toOnboardingDto(applied.record ?? record);
  }
}

export function toOnboardingDto(record: OnboardingRecord) {
  return {
    id: record.id,
    object: 'onboarding' as const,
    account_id: record.accountId ?? null,
    holder_id: record.holderId,
    type: record.type,
    status: record.status,
    rejection_code: record.rejectionCode ?? null,
    rejection_message: record.rejectionMessage ?? null,
    provider_rejection_code: record.providerRejectionCode ?? null,
    requirements: record.requirements.map((requirement) => ({
      id: requirement.id,
      code: requirement.code,
      status: requirement.status,
      label: requirement.label,
      document_id: requirement.documentId ?? null,
      attempts: requirement.attempts,
    })),
    pending_requirements: record.requirements
      .filter((requirement) => requirement.status === RequirementStatus.PENDING)
      .map((requirement) => requirement.code),
    submitted_at: record.submittedAt?.toISOString() ?? null,
    decided_at: record.decidedAt?.toISOString() ?? null,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}
