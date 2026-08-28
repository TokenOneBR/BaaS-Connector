import type { OnboardingCase, PendingRequirement } from '@baasconn/provider-spi';
import {
  OnboardingDecision,
  OnboardingRejectionCode,
  OnboardingStatus,
  RequirementCode,
  RequirementStatus,
} from '@baasconn/taxonomy';

import type { MbOnboarding } from '../dto/index.js';

/**
 * O Mock Bank ja devolve `situacao` no vocabulario canonico de onboarding.
 *
 * Isso e sorte, nao contrato: a funcao existe para que o dia em que ele mudar,
 * mude UM lugar. Um valor desconhecido vira IN_ANALYSIS — o estado neutro que
 * nao aprova nem recusa ninguem por engano.
 */
export function toOnboardingStatus(situacao: string): OnboardingStatus {
  if (situacao in OnboardingStatus) {
    return OnboardingStatus[situacao as keyof typeof OnboardingStatus];
  }
  return OnboardingStatus.IN_ANALYSIS;
}

function toRequirementCode(codigo: string): RequirementCode | undefined {
  return codigo in RequirementCode
    ? RequirementCode[codigo as keyof typeof RequirementCode]
    : undefined;
}

function toRejectionCode(motivo: string | null): OnboardingRejectionCode | undefined {
  if (!motivo) return undefined;
  return motivo in OnboardingRejectionCode
    ? OnboardingRejectionCode[motivo as keyof typeof OnboardingRejectionCode]
    : OnboardingRejectionCode.PROVIDER_POLICY;
}

const DECIDED: ReadonlySet<OnboardingStatus> = new Set([
  OnboardingStatus.APPROVED,
  OnboardingStatus.REJECTED,
]);

export function toOnboardingCase(onboarding: MbOnboarding): OnboardingCase {
  const status = toOnboardingStatus(onboarding.situacao);

  /**
   * Conjunto COMPLETO de pendencias, nao um delta.
   *
   * O Mock Bank so lista as `PENDING`, entao o conjunto ja e completo por
   * construcao. O core faz set-diff contra o que tinha; devolver um delta aqui
   * faria a lista virar append-only e nunca limpar.
   */
  const pendingRequirements: PendingRequirement[] = onboarding.pendencias.flatMap((pendencia) => {
    const code = toRequirementCode(pendencia.codigo);
    if (!code) return [];
    return [
      {
        code,
        providerCode: pendencia.codigo,
        description: pendencia.codigo,
        status: RequirementStatus.PENDING,
      },
    ];
  });

  return {
    providerCaseId: onboarding.id,
    status,
    decision: DECIDED.has(status)
      ? {
          outcome:
            status === OnboardingStatus.APPROVED
              ? OnboardingDecision.APPROVE
              : OnboardingDecision.REJECT,
          reasonCode: toRejectionCode(onboarding.motivo_recusa),
          providerReasonCode: onboarding.motivo_recusa ?? undefined,
          reason: onboarding.mensagem_recusa ?? undefined,
        }
      : undefined,
    pendingRequirements,
    updatedAt: onboarding.atualizado_em,
    raw: onboarding,
  };
}
