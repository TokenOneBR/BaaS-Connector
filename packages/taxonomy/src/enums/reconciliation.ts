export enum ReconciliationScope {
  DAILY = 'DAILY',
  INTRADAY = 'INTRADAY',
  BACKFILL = 'BACKFILL',
  MANUAL = 'MANUAL',
}

export enum ReconciliationRunStatus {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  COMPLETED_WITH_BREAKS = 'COMPLETED_WITH_BREAKS',
  FAILED = 'FAILED',
}

/** Lado da comparacao. P = provedor, C = conector, L = ledger sombra. */
export enum ReconciliationSide {
  PROVIDER = 'PROVIDER',
  LOCAL = 'LOCAL',
  LEDGER = 'LEDGER',
}

export enum BreakType {
  /** O provedor tem, nos nao: webhook perdido. */
  MISSING_ON_LOCAL = 'MISSING_ON_LOCAL',
  /** Nos temos, o provedor nao: possivel fantasma ou desfecho desconhecido. */
  MISSING_ON_PROVIDER = 'MISSING_ON_PROVIDER',
  /** Registrada mas nao lancada no ledger. Sempre critico. */
  MISSING_ON_LEDGER = 'MISSING_ON_LEDGER',
  AMOUNT_MISMATCH = 'AMOUNT_MISMATCH',
  STATUS_MISMATCH = 'STATUS_MISMATCH',
  DUPLICATE_LOCAL = 'DUPLICATE_LOCAL',
  DUPLICATE_PROVIDER = 'DUPLICATE_PROVIDER',
  /** Postada em data efetiva diferente (deriva D+1). */
  DATE_MISMATCH = 'DATE_MISMATCH',
  /** Saldo de fechamento diverge mesmo com todos os itens casados. */
  BALANCE_MISMATCH = 'BALANCE_MISMATCH',
  UNMATCHED_FEE = 'UNMATCHED_FEE',
  ORPHAN_REFUND = 'ORPHAN_REFUND',
}

export enum BreakSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum BreakStatus {
  OPEN = 'OPEN',
  INVESTIGATING = 'INVESTIGATING',
  RESOLVED = 'RESOLVED',
  WRITTEN_OFF = 'WRITTEN_OFF',
  AUTO_RESOLVED = 'AUTO_RESOLVED',
}

export enum ResolutionAction {
  IMPORT_FROM_PROVIDER = 'IMPORT_FROM_PROVIDER',
  MARK_PROVIDER_AUTHORITATIVE = 'MARK_PROVIDER_AUTHORITATIVE',
  CREATE_LEDGER_ADJUSTMENT = 'CREATE_LEDGER_ADJUSTMENT',
  CANCEL_LOCAL_RECORD = 'CANCEL_LOCAL_RECORD',
  MERGE_DUPLICATE = 'MERGE_DUPLICATE',
  IGNORE_TIMING_DIFFERENCE = 'IGNORE_TIMING_DIFFERENCE',
  WRITE_OFF = 'WRITE_OFF',
  ESCALATE_TO_PROVIDER = 'ESCALATE_TO_PROVIDER',
}

export enum MatchConfidence {
  EXACT = 'EXACT',
  HIGH = 'HIGH',
  LOW = 'LOW',
}
