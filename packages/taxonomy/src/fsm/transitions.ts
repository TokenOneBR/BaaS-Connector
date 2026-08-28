import { AccountStatus } from '../enums/account.js';
import { OnboardingStatus, RequirementStatus } from '../enums/onboarding.js';
import { PixChargeStatus, PixKeyStatus } from '../enums/pix.js';
import { TransactionStatus } from '../enums/transaction.js';

export type TransitionTable<S extends string> = Readonly<Record<S, readonly S[]>>;

export const ACCOUNT_STATUS_TRANSITIONS: TransitionTable<AccountStatus> = Object.freeze({
  [AccountStatus.DRAFT]: [AccountStatus.PENDING_ONBOARDING, AccountStatus.REJECTED],
  [AccountStatus.PENDING_ONBOARDING]: [
    AccountStatus.PENDING_DOCUMENTS,
    AccountStatus.UNDER_REVIEW,
    AccountStatus.ACTIVE,
    AccountStatus.REJECTED,
  ],
  [AccountStatus.PENDING_DOCUMENTS]: [
    AccountStatus.UNDER_REVIEW,
    AccountStatus.PENDING_ONBOARDING,
    AccountStatus.ACTIVE,
    AccountStatus.REJECTED,
  ],
  [AccountStatus.UNDER_REVIEW]: [
    AccountStatus.ACTIVE,
    AccountStatus.PENDING_DOCUMENTS,
    AccountStatus.REJECTED,
  ],
  [AccountStatus.ACTIVE]: [AccountStatus.BLOCKED, AccountStatus.SUSPENDED, AccountStatus.CLOSING],
  [AccountStatus.BLOCKED]: [AccountStatus.ACTIVE, AccountStatus.CLOSING, AccountStatus.CLOSED],
  [AccountStatus.SUSPENDED]: [AccountStatus.ACTIVE, AccountStatus.CLOSING],
  [AccountStatus.REJECTED]: [],
  [AccountStatus.CLOSING]: [AccountStatus.CLOSED, AccountStatus.ACTIVE],
  [AccountStatus.CLOSED]: [],
});

export const ONBOARDING_STATUS_TRANSITIONS: TransitionTable<OnboardingStatus> = Object.freeze({
  [OnboardingStatus.DRAFT]: [OnboardingStatus.SUBMITTED, OnboardingStatus.CANCELLED],
  [OnboardingStatus.SUBMITTED]: [
    OnboardingStatus.IN_ANALYSIS,
    OnboardingStatus.PENDING_REQUIREMENTS,
    OnboardingStatus.MANUAL_REVIEW,
    OnboardingStatus.APPROVED,
    OnboardingStatus.REJECTED,
    OnboardingStatus.EXPIRED,
  ],
  // Provedores legitimamente reabrem pendencias, entao esta transicao volta.
  [OnboardingStatus.PENDING_REQUIREMENTS]: [
    OnboardingStatus.IN_ANALYSIS,
    OnboardingStatus.SUBMITTED,
    OnboardingStatus.MANUAL_REVIEW,
    OnboardingStatus.APPROVED,
    OnboardingStatus.REJECTED,
    OnboardingStatus.EXPIRED,
    OnboardingStatus.CANCELLED,
  ],
  [OnboardingStatus.IN_ANALYSIS]: [
    OnboardingStatus.PENDING_REQUIREMENTS,
    OnboardingStatus.MANUAL_REVIEW,
    OnboardingStatus.APPROVED,
    OnboardingStatus.REJECTED,
    OnboardingStatus.EXPIRED,
  ],
  [OnboardingStatus.MANUAL_REVIEW]: [
    OnboardingStatus.APPROVED,
    OnboardingStatus.REJECTED,
    OnboardingStatus.PENDING_REQUIREMENTS,
    OnboardingStatus.EXPIRED,
  ],
  [OnboardingStatus.APPROVED]: [],
  [OnboardingStatus.REJECTED]: [],
  [OnboardingStatus.EXPIRED]: [],
  [OnboardingStatus.CANCELLED]: [],
});

export const TRANSACTION_STATUS_TRANSITIONS: TransitionTable<TransactionStatus> = Object.freeze({
  [TransactionStatus.CREATED]: [
    TransactionStatus.PENDING,
    TransactionStatus.PROCESSING,
    TransactionStatus.FAILED,
    TransactionStatus.CANCELLED,
    TransactionStatus.UNKNOWN,
  ],
  [TransactionStatus.PENDING]: [
    TransactionStatus.PROCESSING,
    TransactionStatus.SETTLED,
    TransactionStatus.FAILED,
    TransactionStatus.CANCELLED,
    TransactionStatus.UNKNOWN,
  ],
  [TransactionStatus.PROCESSING]: [
    TransactionStatus.SETTLED,
    TransactionStatus.FAILED,
    TransactionStatus.UNKNOWN,
  ],
  // SETTLED e terminal, exceto por reversao. Nao ha volta para PROCESSING.
  [TransactionStatus.SETTLED]: [TransactionStatus.REVERSED, TransactionStatus.PARTIALLY_REVERSED],
  [TransactionStatus.PARTIALLY_REVERSED]: [
    TransactionStatus.REVERSED,
    TransactionStatus.PARTIALLY_REVERSED,
  ],
  [TransactionStatus.FAILED]: [],
  [TransactionStatus.CANCELLED]: [],
  [TransactionStatus.REVERSED]: [],
  [TransactionStatus.UNKNOWN]: [
    TransactionStatus.PENDING,
    TransactionStatus.PROCESSING,
    TransactionStatus.SETTLED,
    TransactionStatus.FAILED,
    TransactionStatus.CANCELLED,
  ],
});

export const PIX_KEY_STATUS_TRANSITIONS: TransitionTable<PixKeyStatus> = Object.freeze({
  [PixKeyStatus.PENDING_REGISTRATION]: [
    PixKeyStatus.PENDING_OWNERSHIP_CONFIRMATION,
    PixKeyStatus.PENDING_PORTABILITY_IN,
    PixKeyStatus.ACTIVE,
    PixKeyStatus.REJECTED,
  ],
  [PixKeyStatus.PENDING_OWNERSHIP_CONFIRMATION]: [PixKeyStatus.ACTIVE, PixKeyStatus.REJECTED],
  [PixKeyStatus.ACTIVE]: [
    PixKeyStatus.PENDING_PORTABILITY_OUT,
    PixKeyStatus.PENDING_CLAIM_IN,
    PixKeyStatus.PENDING_CLAIM_OUT,
    PixKeyStatus.REMOVED,
  ],
  [PixKeyStatus.PENDING_PORTABILITY_IN]: [PixKeyStatus.ACTIVE, PixKeyStatus.REJECTED],
  [PixKeyStatus.PENDING_PORTABILITY_OUT]: [PixKeyStatus.REMOVED, PixKeyStatus.ACTIVE],
  [PixKeyStatus.PENDING_CLAIM_IN]: [PixKeyStatus.ACTIVE, PixKeyStatus.REJECTED],
  [PixKeyStatus.PENDING_CLAIM_OUT]: [PixKeyStatus.REMOVED, PixKeyStatus.ACTIVE],
  [PixKeyStatus.REMOVED]: [],
  [PixKeyStatus.REJECTED]: [],
});

export const PIX_CHARGE_STATUS_TRANSITIONS: TransitionTable<PixChargeStatus> = Object.freeze({
  [PixChargeStatus.ACTIVE]: [
    PixChargeStatus.COMPLETED,
    PixChargeStatus.EXPIRED,
    PixChargeStatus.REMOVED_BY_PSP,
    PixChargeStatus.REMOVED_BY_USER,
  ],
  [PixChargeStatus.COMPLETED]: [],
  [PixChargeStatus.EXPIRED]: [],
  [PixChargeStatus.REMOVED_BY_PSP]: [],
  [PixChargeStatus.REMOVED_BY_USER]: [],
});

export const REQUIREMENT_STATUS_TRANSITIONS: TransitionTable<RequirementStatus> = Object.freeze({
  [RequirementStatus.PENDING]: [
    RequirementStatus.SUBMITTED,
    RequirementStatus.WAIVED,
    RequirementStatus.EXPIRED,
  ],
  [RequirementStatus.SUBMITTED]: [
    RequirementStatus.IN_ANALYSIS,
    RequirementStatus.ACCEPTED,
    RequirementStatus.REJECTED,
  ],
  [RequirementStatus.IN_ANALYSIS]: [RequirementStatus.ACCEPTED, RequirementStatus.REJECTED],
  [RequirementStatus.REJECTED]: [RequirementStatus.SUBMITTED, RequirementStatus.EXPIRED],
  [RequirementStatus.ACCEPTED]: [],
  [RequirementStatus.WAIVED]: [],
  [RequirementStatus.EXPIRED]: [RequirementStatus.SUBMITTED],
});

/**
 * Ranks monotonicos usados pelo guard de ingestao de eventos.
 *
 * UNKNOWN fica em 0 de proposito: qualquer informacao concreta do provedor
 * (inclusive "pendente") supera "nao sei se o dinheiro se moveu".
 * SETTLED e FAILED compartilham o rank porque sao desfechos alternativos do
 * mesmo ponto: um nunca deve sobrescrever o outro por chegar depois.
 */
export const TRANSACTION_STATUS_RANKS: Readonly<Record<TransactionStatus, number>> = Object.freeze({
  [TransactionStatus.UNKNOWN]: 0,
  [TransactionStatus.CREATED]: 1,
  [TransactionStatus.PENDING]: 2,
  [TransactionStatus.PROCESSING]: 3,
  [TransactionStatus.SETTLED]: 4,
  [TransactionStatus.FAILED]: 4,
  [TransactionStatus.CANCELLED]: 4,
  [TransactionStatus.PARTIALLY_REVERSED]: 5,
  [TransactionStatus.REVERSED]: 6,
});

export const ACCOUNT_STATUS_RANKS: Readonly<Record<AccountStatus, number>> = Object.freeze({
  [AccountStatus.DRAFT]: 0,
  [AccountStatus.PENDING_ONBOARDING]: 1,
  [AccountStatus.PENDING_DOCUMENTS]: 2,
  [AccountStatus.UNDER_REVIEW]: 3,
  [AccountStatus.ACTIVE]: 4,
  [AccountStatus.REJECTED]: 4,
  [AccountStatus.SUSPENDED]: 5,
  [AccountStatus.BLOCKED]: 5,
  [AccountStatus.CLOSING]: 6,
  [AccountStatus.CLOSED]: 7,
});

/**
 * Onboarding permite transicoes de rank igual, porque um provedor pode mover
 * um caso entre PENDING_REQUIREMENTS e IN_ANALYSIS varias vezes de forma
 * legitima. Aqui o guard depende mais do `occurredAt` que do rank.
 */
export const ONBOARDING_STATUS_RANKS: Readonly<Record<OnboardingStatus, number>> = Object.freeze({
  [OnboardingStatus.DRAFT]: 0,
  [OnboardingStatus.SUBMITTED]: 1,
  [OnboardingStatus.PENDING_REQUIREMENTS]: 2,
  [OnboardingStatus.IN_ANALYSIS]: 2,
  [OnboardingStatus.MANUAL_REVIEW]: 3,
  [OnboardingStatus.APPROVED]: 4,
  [OnboardingStatus.REJECTED]: 4,
  [OnboardingStatus.EXPIRED]: 4,
  [OnboardingStatus.CANCELLED]: 4,
});
