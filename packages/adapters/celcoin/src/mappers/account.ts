import type { ProviderAccount } from '@baasconn/provider-spi';
import { AccountStatus, HolderType, OnboardingStatus, TaxIdType } from '@baasconn/taxonomy';

import type { CcAccount, CcProposal } from '../dto/index.js';

/**
 * Situacao de conta da Celcoin para a canonica.
 *
 * A tabela e EXPLICITA e o desconhecido cai em `UNDER_REVIEW`, nunca em
 * `ACTIVE`. Um status novo que o provedor introduza e que caisse em ACTIVE por
 * omissao liberaria movimentacao numa conta cujo estado real nao conhecemos.
 * Sob revisao e o desfecho conservador: bloqueia e chama humano.
 */
const ACCOUNT_STATUS: Readonly<Record<string, AccountStatus>> = Object.freeze({
  ACTIVE: AccountStatus.ACTIVE,
  ATIVA: AccountStatus.ACTIVE,
  PENDING: AccountStatus.PENDING_ONBOARDING,
  PROCESSING: AccountStatus.PENDING_ONBOARDING,
  BLOCKED: AccountStatus.BLOCKED,
  BLOQUEADA: AccountStatus.BLOCKED,
  SUSPENDED: AccountStatus.SUSPENDED,
  CLOSED: AccountStatus.CLOSED,
  ENCERRADA: AccountStatus.CLOSED,
  CANCELED: AccountStatus.CLOSED,
  DENIED: AccountStatus.REJECTED,
  REJECTED: AccountStatus.REJECTED,
});

/**
 * Situacao de proposta para a canonica de onboarding.
 *
 * `CONFIRMED`/`APPROVED` sao os dois nomes que a documentacao usa para o mesmo
 * desfecho em lugares diferentes; mapear so um deixaria metade das aprovacoes
 * presas em analise.
 */
const PROPOSAL_STATUS: Readonly<Record<string, OnboardingStatus>> = Object.freeze({
  PENDING: OnboardingStatus.IN_ANALYSIS,
  PROCESSING: OnboardingStatus.IN_ANALYSIS,
  IN_ANALYSIS: OnboardingStatus.IN_ANALYSIS,
  MANUAL_ANALYSIS: OnboardingStatus.MANUAL_REVIEW,
  MANUAL_REVIEW: OnboardingStatus.MANUAL_REVIEW,
  PENDING_DOCUMENTS: OnboardingStatus.PENDING_REQUIREMENTS,
  CONFIRMED: OnboardingStatus.APPROVED,
  APPROVED: OnboardingStatus.APPROVED,
  DENIED: OnboardingStatus.REJECTED,
  REJECTED: OnboardingStatus.REJECTED,
  CANCELED: OnboardingStatus.CANCELLED,
  EXPIRED: OnboardingStatus.EXPIRED,
});

export function toAccountStatus(status: string): AccountStatus {
  return ACCOUNT_STATUS[status.toUpperCase()] ?? AccountStatus.UNDER_REVIEW;
}

export function toOnboardingStatus(status: string): OnboardingStatus {
  return PROPOSAL_STATUS[status.toUpperCase()] ?? OnboardingStatus.IN_ANALYSIS;
}

/** 11 digitos e CPF, 14 e CNPJ. Nao ha ambiguidade no documento brasileiro. */
export function taxIdOf(value: string): { type: TaxIdType; value: string } {
  const digits = value.replace(/\D/g, '');
  return { type: digits.length === 14 ? TaxIdType.CNPJ : TaxIdType.CPF, value: digits };
}

export function toProviderAccount(account: CcAccount): ProviderAccount {
  const digits = account.documentNumber.replace(/\D/g, '');

  return {
    // O `clientCode` e o identificador que NOS mandamos e que a Celcoin ecoa;
    // `account` so aparece depois da aprovacao. Usar `account` como chave
    // deixaria a conta sem identificador entre a criacao e a aprovacao.
    providerAccountId: account.account ?? account.clientCode,
    status: toAccountStatus(account.status),
    personType: digits.length === 14 ? HolderType.BUSINESS : HolderType.INDIVIDUAL,
    bank: account.account
      ? { ispb: CELCOIN_ISPB, branch: account.branch ?? '0001', number: account.account }
      : undefined,
    openedAt: account.createdAt,
    raw: account,
  };
}

export function toOnboardingCaseId(proposal: CcProposal): string {
  return proposal.proposalId;
}

/** ISPB da Celcoin Instituicao de Pagamento. */
export const CELCOIN_ISPB = '13935893';
