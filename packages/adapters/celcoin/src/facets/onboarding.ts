import type { HttpClient } from '@baasconn/adapter-kit';
import type {
  AccountRef,
  DocumentReceipt,
  OnboardingCase,
  OnboardingFacet,
  PendingRequirement,
} from '@baasconn/provider-spi';
import {
  BaasError,
  BaasErrorCode,
  OnboardingDecision,
  OnboardingStatus,
  RequirementCode,
  RequirementStatus,
} from '@baasconn/taxonomy';

import type { CcEnvelope, CcProposal } from '../dto/index.js';
import { paths } from '../endpoints.js';
import { toOnboardingStatus } from '../mappers/account.js';

/**
 * Onboarding da Celcoin, que e EMULADO.
 *
 * Nao existe rota de "submeter KYC": a proposta nasce junto com a conta e
 * segue sozinha para background check, com o desfecho voltando por webhook.
 * Entao `submitKyc`/`submitKyb` LEEM a proposta em vez de criar uma — e e
 * exatamente por isso que o manifesto os declara `EMULATED` com nota, em vez
 * de `SUPPORTED`: o efeito e equivalente, o mecanismo nao e, e quem integra
 * precisa saber a diferenca antes de desenhar o proprio fluxo.
 */
export function buildOnboardingFacet(client: HttpClient): OnboardingFacet {
  const readProposal = async (clientCode: string): Promise<OnboardingCase> => {
    const response = await client.request<CcEnvelope<CcProposal>>({
      method: 'GET',
      path: paths.proposal,
      query: { clientCode },
      endpointClass: 'read',
    });
    return toCase(response.body.body);
  };

  return {
    submitKyc: (ref: AccountRef) => readProposal(ref.providerAccountId),
    submitKyb: (ref: AccountRef) => readProposal(ref.providerAccountId),
    getStatus: (providerCaseId: string) => readProposal(providerCaseId),

    async listRequirements(providerCaseId: string): Promise<PendingRequirement[]> {
      return (await readProposal(providerCaseId)).pendingRequirements;
    },

    uploadDocument: (): Promise<DocumentReceipt> => unsupported('onboarding.document.upload'),
    fulfillRequirement: (): Promise<OnboardingCase> =>
      unsupported('onboarding.requirements.fulfill'),
  };
}

function toCase(proposal: CcProposal): OnboardingCase {
  const status = toOnboardingStatus(proposal.status);

  return {
    providerCaseId: proposal.proposalId,
    status,
    decision: proposal.reasonCode
      ? {
          outcome:
            status === OnboardingStatus.APPROVED
              ? OnboardingDecision.APPROVE
              : OnboardingDecision.REJECT,
          // O codigo do provedor e preservado LITERALMENTE ao lado do
          // canonico: e o que o suporte da Celcoin pede numa escalacao, e
          // traduzi-lo e perder a unica informacao que eles reconhecem.
          providerReasonCode: proposal.reasonCode,
          reason: proposal.reason,
        }
      : undefined,
    // Conjunto COMPLETO, nunca um delta: o core faz set-diff contra o que ja
    // tinha, e uma lista incremental viraria append-only que nunca limpa.
    pendingRequirements: (proposal.pendingDocuments ?? []).map(toRequirement),
    updatedAt: proposal.createdAt ?? new Date(0).toISOString(),
    raw: proposal,
  };
}

function toRequirement(code: string): PendingRequirement {
  return {
    code:
      code in RequirementCode
        ? RequirementCode[code as keyof typeof RequirementCode]
        : RequirementCode.ADDITIONAL_INFORMATION,
    providerCode: code,
    description: code,
    status: RequirementStatus.PENDING,
  };
}

function unsupported<T>(capability: string): Promise<T> {
  return Promise.reject(
    new BaasError(BaasErrorCode.CAPABILITY_NOT_SUPPORTED, {
      message: `A Celcoin nao expoe ${capability} na documentacao publica consultada.`,
    }),
  );
}
