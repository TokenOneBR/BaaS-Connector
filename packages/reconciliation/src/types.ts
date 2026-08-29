import type {
  BreakSeverity,
  BreakType,
  Environment,
  MatchConfidence,
  ReconciliationScope,
  ReconciliationSide,
  ResolutionAction,
  TransactionStatus,
} from '@baasconn/taxonomy';

export type Direction = 'CREDIT' | 'DEBIT';

/** `yyyy-MM-dd` no fuso de Brasilia. NUNCA derivada de UTC. */
export type EffectiveDate = string;

/**
 * Item normalizado de qualquer um dos tres lados.
 *
 * O motor so ve isto. Quem traduz `StatementEntry`, `Transaction` e
 * `LedgerEntry` para ca e o worker — e e o que permite testar os cinco passes
 * sem Postgres, sem Nest e sem HTTP.
 */
export interface NormalizedItem {
  id: string;
  side: ReconciliationSide;
  accountId: string;
  externalId?: string;
  endToEndId?: string;
  postedAt: Date;
  effectiveDate: EffectiveDate;
  direction: Direction;
  /** Bruto, sempre positivo. O sinal vive em `direction`. */
  amountCents: bigint;
  type: string;
  /** So P e C tem status de dominio; o razao nao tem. */
  status?: TransactionStatus;
  /** Blind index. O documento da contraparte nunca entra aqui. */
  counterpartyTaxIdIndex?: string;
  providerTransactionId?: string;
  /** Em C, vem de `ledgerPostedTransactionId`; em L, e o id da transacao. */
  ledgerTransactionId?: string;
  matchKeyStrong?: string;
  matchKeyFuzzy: string;
  /** Redigido e SEM `bigint`: vai para coluna Json, e `stringify` lanca. */
  raw: Readonly<Record<string, unknown>>;
}

export interface BusinessCalendar {
  isBusinessDay(date: EffectiveDate): boolean;
  addBusinessDays(date: EffectiveDate, days: number): EffectiveDate;
  businessDaysBetween(from: EffectiveDate, to: EffectiveDate): number;
}

export interface ReconciliationPolicy {
  /** Janela recente: falta no provedor e pendencia de liquidacao, nao quebra. */
  settlementGraceMinutes: number;
  amountToleranceCents: bigint;
  /** 0,01% = 1 ponto-base. */
  amountToleranceBasisPoints: bigint;
  dateToleranceBusinessDays: number;
  autoResolveDateWithinBusinessDays: number;
  /** Acima deste delta, `AMOUNT_MISMATCH` e CRITICAL. */
  criticalAmountDeltaCents: bigint;
  /** Balde n:m maior que isto nao e adivinhado. */
  maxGreedyPairs: number;
  calendar: BusinessCalendar;
}

export interface ReconciliationInput {
  runId: string;
  environment: Environment;
  connectionId: string;
  accountId: string;
  scope: ReconciliationScope;
  window: { start: Date; end: Date };
  now: Date;
  provider: readonly NormalizedItem[];
  local: readonly NormalizedItem[];
  ledger: readonly NormalizedItem[];
  balances: {
    providerOpeningCents?: bigint;
    providerClosingCents?: bigint;
    ledgerClosingCents?: bigint;
  };
  policy: ReconciliationPolicy;
}

export interface MatchLink {
  providerItemId?: string;
  localItemId?: string;
  ledgerItemId?: string;
  confidence: MatchConfidence;
  pass: 1 | 2 | 3 | 4;
  /** `LOW` sempre exige revisao humana antes de virar verdade. */
  needsReview: boolean;
}

export type AutoResolutionIntent =
  | { action: ResolutionAction.IMPORT_FROM_PROVIDER; providerItemId: string }
  | {
      action: ResolutionAction.MARK_PROVIDER_AUTHORITATIVE;
      localItemId: string;
      fromStatus: TransactionStatus;
      toStatus: TransactionStatus;
    }
  | {
      action: ResolutionAction.IGNORE_TIMING_DIFFERENCE;
      localItemId: string;
      providerItemId: string;
      driftBusinessDays: number;
    };

export interface BreakDraft {
  type: BreakType;
  severity: BreakSeverity;
  /** NOT NULL e deterministico. Ver a migration de dedup. */
  dedupeKey: string;
  effectiveDate: EffectiveDate;
  endToEndId?: string;
  amountCents?: bigint;
  deltaCents?: bigint;
  providerItemId?: string;
  localItemId?: string;
  ledgerItemId?: string;
  description: string;
  /** Sem `bigint`: vai para coluna Json. */
  evidence: Readonly<Record<string, unknown>>;
  autoResolution?: AutoResolutionIntent;
}

export interface ReconciliationResult {
  matches: MatchLink[];
  breaks: BreakDraft[];
  counters: {
    providerItemCount: number;
    localItemCount: number;
    ledgerItemCount: number;
    matchedCount: number;
    breakCount: number;
  };
  balance: {
    openingCents?: bigint;
    matchedMovementCents: bigint;
    expectedClosingCents?: bigint;
    providerClosingCents?: bigint;
    ledgerClosingCents?: bigint;
    /** Numero de manchete: provedor menos o nosso razao. */
    balanceDeltaCents?: bigint;
    skippedReason?: 'no_provider_opening' | 'no_provider_closing';
  };
  /** Suprimidos pela graca de liquidacao. Nao sao quebra; sao "ainda nao". */
  pendingSettlement: string[];
}

/**
 * Tolerancia de valor.
 *
 * Teto inteiro de `amount * bps / 10000`, piso de um centavo. Tudo em
 * `bigint`: `amount * 0.0001` em float perde precisao acima de ~9e13 centavos
 * e a tolerancia cresce em SILENCIO — casamentos errados exatamente nos
 * valores que mais importam.
 */
export function amountTolerance(amountCents: bigint, basisPoints: bigint): bigint {
  const absoluto = amountCents < 0n ? -amountCents : amountCents;
  const proporcional = (absoluto * basisPoints + 9_999n) / 10_000n;
  return proporcional > 1n ? proporcional : 1n;
}
