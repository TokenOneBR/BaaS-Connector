import {
  AccountStatus,
  BreakSeverity,
  BreakStatus,
  OnboardingStatus,
  TransactionStatus,
} from '@baasconn/taxonomy';

type Tom = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const CLASSES: Readonly<Record<Tom, string>> = {
  neutral: 'bg-surface-raised text-text-muted',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger',
  info: 'bg-info/15 text-info',
};

/**
 * UM lugar traduz status em cor.
 *
 * Os mapas abaixo sao EXAUSTIVOS por construcao: sao `Record<Enum, Tom>`, e um
 * valor novo na taxonomia vira erro de compilacao aqui em vez de uma pill sem
 * estilo em producao. E foi por isso que a exaustividade veio do tipo, e nao
 * de um `switch` com `default` — um `default` engoliria o status novo e o
 * sintoma seria cosmetico ate alguem confiar na cor.
 */
const CONTA: Readonly<Record<AccountStatus, Tom>> = {
  [AccountStatus.DRAFT]: 'neutral',
  [AccountStatus.PENDING_ONBOARDING]: 'info',
  [AccountStatus.PENDING_DOCUMENTS]: 'warning',
  [AccountStatus.UNDER_REVIEW]: 'warning',
  [AccountStatus.ACTIVE]: 'success',
  [AccountStatus.BLOCKED]: 'danger',
  [AccountStatus.SUSPENDED]: 'danger',
  [AccountStatus.REJECTED]: 'danger',
  [AccountStatus.CLOSING]: 'neutral',
  [AccountStatus.CLOSED]: 'neutral',
};

const TRANSACAO: Readonly<Record<TransactionStatus, Tom>> = {
  [TransactionStatus.CREATED]: 'neutral',
  [TransactionStatus.PENDING]: 'info',
  [TransactionStatus.PROCESSING]: 'info',
  [TransactionStatus.SETTLED]: 'success',
  [TransactionStatus.FAILED]: 'danger',
  [TransactionStatus.CANCELLED]: 'neutral',
  [TransactionStatus.REVERSED]: 'warning',
  [TransactionStatus.PARTIALLY_REVERSED]: 'warning',
  // `UNKNOWN` e AMARELO, nao cinza. Significa "o dinheiro pode ter saido e nao
  // sabemos" — o estado mais importante do modelo, e o que uma cor neutra
  // faria o operador ignorar.
  [TransactionStatus.UNKNOWN]: 'warning',
};

const ONBOARDING: Readonly<Record<OnboardingStatus, Tom>> = {
  [OnboardingStatus.DRAFT]: 'neutral',
  [OnboardingStatus.SUBMITTED]: 'info',
  [OnboardingStatus.PENDING_REQUIREMENTS]: 'warning',
  [OnboardingStatus.IN_ANALYSIS]: 'info',
  [OnboardingStatus.MANUAL_REVIEW]: 'warning',
  [OnboardingStatus.APPROVED]: 'success',
  [OnboardingStatus.REJECTED]: 'danger',
  [OnboardingStatus.EXPIRED]: 'neutral',
  [OnboardingStatus.CANCELLED]: 'neutral',
};

const QUEBRA: Readonly<Record<BreakStatus, Tom>> = {
  [BreakStatus.OPEN]: 'danger',
  [BreakStatus.INVESTIGATING]: 'warning',
  [BreakStatus.RESOLVED]: 'success',
  [BreakStatus.WRITTEN_OFF]: 'neutral',
  [BreakStatus.AUTO_RESOLVED]: 'success',
};

const SEVERIDADE: Readonly<Record<BreakSeverity, Tom>> = {
  [BreakSeverity.LOW]: 'neutral',
  [BreakSeverity.MEDIUM]: 'info',
  [BreakSeverity.HIGH]: 'warning',
  [BreakSeverity.CRITICAL]: 'danger',
};

export const MAPAS = {
  account: CONTA,
  transaction: TRANSACAO,
  onboarding: ONBOARDING,
  break: QUEBRA,
  severity: SEVERIDADE,
} as const;

export type StatusKind = keyof typeof MAPAS;

export function toneFor(kind: StatusKind, status: string): Tom {
  return (MAPAS[kind] as Record<string, Tom>)[status] ?? 'neutral';
}

export function StatusBadge({ kind, status }: { kind: StatusKind; status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${CLASSES[toneFor(kind, status)]}`}
    >
      {status}
    </span>
  );
}
