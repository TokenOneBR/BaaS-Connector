import type {
  BreakStatus,
  BreakType,
  Environment,
  ReconciliationRunStatus,
  ResolutionAction,
} from '@baasconn/taxonomy';

import type {
  PollCursorRecord,
  PollCursorRepository,
} from '../../reconciliation/poll-cursor.types.js';
import type {
  BreakUpsertRow,
  ReconciliationBreakRecord,
  MatchLinkRow,
  ReconciliationBreakRepository,
  ReconciliationItemRow,
  ReconciliationRunRecord,
  ReconciliationRunRepository,
  RunBalances,
  RunCounters,
  UpsertedBreak,
} from '../../reconciliation/reconciliation.types.js';

/**
 * Dobros de conciliacao.
 *
 * Reproduzem a semantica que decide correcao — execucao idempotente por
 * janela, dedup por chave derivada, `firstSeenRunId` que nao se move,
 * reabertura de resolvida — e NAO o SQL. O `xmax = 0`, o `ON CONFLICT` e o
 * escopo do fechamento continuam provados contra Postgres de verdade nos
 * testes de invariante.
 */
export class MemoryReconciliationRunRepository implements ReconciliationRunRepository {
  readonly runs = new Map<string, ReconciliationRunRecord & { counters?: RunCounters }>();
  readonly items = new Map<string, ReconciliationItemRow>();
  readonly matches: MatchLinkRow[] = [];
  readonly failures = new Map<string, Record<string, unknown>>();

  private key(input: {
    connectionId: string;
    accountId: string;
    scope: string;
    windowStart: Date;
    windowEnd: Date;
  }): string {
    return [
      input.connectionId,
      input.accountId,
      input.scope,
      input.windowStart.toISOString(),
      input.windowEnd.toISOString(),
    ].join('|');
  }

  async startRun(
    input: Parameters<ReconciliationRunRepository['startRun']>[0],
  ): Promise<{ run: ReconciliationRunRecord; created: boolean }> {
    const chave = this.key(input);
    const existente = [...this.runs.values()].find((run) => this.key(run) === chave);
    if (existente) return { run: existente, created: false };

    const run: ReconciliationRunRecord = {
      ...input,
      status: 'QUEUED' as ReconciliationRunStatus,
      createdAt: input.windowEnd,
    };
    this.runs.set(run.id, run);
    return { run, created: true };
  }

  async findById(
    environment: Environment,
    id: string,
  ): Promise<ReconciliationRunRecord | undefined> {
    const run = this.runs.get(id);
    return run?.environment === environment ? run : undefined;
  }

  async list(
    input: Parameters<ReconciliationRunRepository['list']>[0],
  ): Promise<{ data: ReconciliationRunRecord[]; nextCursor?: string }> {
    const filtradas = [...this.runs.values()]
      .filter((run) => run.environment === input.environment)
      .filter((run) => !input.connectionId || run.connectionId === input.connectionId)
      .filter((run) => !input.accountId || run.accountId === input.accountId)
      .filter((run) => !input.status || run.status === input.status)
      .sort((a, b) => b.id.localeCompare(a.id))
      .filter((run) => !input.cursor || run.id < input.cursor);

    const data = filtradas.slice(0, input.limit);
    return { data, nextCursor: filtradas.length > input.limit ? data.at(-1)?.id : undefined };
  }

  async findItemById(id: string): Promise<ReconciliationItemRow | undefined> {
    return this.items.get(id);
  }

  async markRunning(id: string): Promise<void> {
    const run = this.runs.get(id);
    if (run) run.status = 'RUNNING' as ReconciliationRunStatus;
  }

  async insertItems(rows: readonly ReconciliationItemRow[]): Promise<void> {
    for (const row of rows) this.items.set(row.id, row);
  }

  async linkMatches(rows: readonly MatchLinkRow[]): Promise<void> {
    this.matches.push(...rows);
  }

  async complete(input: {
    id: string;
    status: ReconciliationRunStatus;
    counters: RunCounters;
    balances: RunBalances;
  }): Promise<void> {
    const run = this.runs.get(input.id);
    if (!run) return;
    run.status = input.status;
    run.counters = input.counters;
    run.balances = input.balances;
  }

  async fail(id: string, error: Record<string, unknown>): Promise<void> {
    const run = this.runs.get(id);
    if (run) run.status = 'FAILED' as ReconciliationRunStatus;
    this.failures.set(id, error);
  }
}

interface StoredBreak extends BreakUpsertRow {
  status: BreakStatus;
  firstSeenRunId: string;
  ageDays: number;
  createdAt: Date;
  resolution?: ResolutionAction;
  resolutionNote?: string;
  resolvedBy?: string;
  resolvedAt?: Date;
  adjustmentTransactionId?: string;
  assignedTo?: string;
}

function toRecord(row: StoredBreak): ReconciliationBreakRecord {
  return { ...row };
}

export class MemoryReconciliationBreakRepository implements ReconciliationBreakRepository {
  readonly rows = new Map<string, StoredBreak>();

  private key(row: {
    connectionId: string;
    type: BreakType;
    effectiveDate: string;
    dedupeKey: string;
  }) {
    return [row.connectionId, row.type, row.effectiveDate, row.dedupeKey].join('|');
  }

  async upsertMany(rows: readonly BreakUpsertRow[], now: Date): Promise<UpsertedBreak[]> {
    const resultados: UpsertedBreak[] = [];

    for (const row of rows) {
      const chave = this.key(row);
      const existente = this.rows.get(chave);

      if (!existente) {
        this.rows.set(chave, {
          ...row,
          status: 'OPEN' as BreakStatus,
          firstSeenRunId: row.runId,
          ageDays: 0,
          createdAt: now,
        });
        resultados.push({ id: row.id, dedupeKey: row.dedupeKey, inserted: true });
        continue;
      }

      // `firstSeenRunId` NAO se move. Copia-lo zeraria a idade a cada
      // execucao, e uma quebra de 30 dias se apresentaria como nova.
      existente.runId = row.runId;
      existente.severity = row.severity;
      existente.amountCents = row.amountCents;
      existente.deltaCents = row.deltaCents;
      existente.description = row.description;
      existente.evidence = row.evidence;
      existente.ageDays = Math.max(
        0,
        Math.floor((now.getTime() - existente.createdAt.getTime()) / 86_400_000),
      );
      if (existente.status === 'RESOLVED' || existente.status === 'AUTO_RESOLVED') {
        existente.status = 'OPEN' as BreakStatus;
      }
      resultados.push({ id: existente.id, dedupeKey: row.dedupeKey, inserted: false });
    }

    return resultados;
  }

  async closeNotRecurring(input: {
    environment: Environment;
    connectionId: string;
    accountId: string;
    fromDate: string;
    toDate: string;
    keepDedupeKeys: readonly string[];
    at: Date;
  }): Promise<number> {
    const manter = new Set(input.keepDedupeKeys);
    let fechadas = 0;

    for (const row of this.rows.values()) {
      if (row.environment !== input.environment) continue;
      if (row.connectionId !== input.connectionId) continue;
      if (row.accountId !== input.accountId) continue;
      if (row.effectiveDate < input.fromDate || row.effectiveDate > input.toDate) continue;
      if (row.status !== 'OPEN' && row.status !== 'INVESTIGATING') continue;
      if (manter.has(row.dedupeKey)) continue;

      row.status = 'AUTO_RESOLVED' as BreakStatus;
      row.resolvedAt = input.at;
      fechadas += 1;
    }

    return fechadas;
  }

  async findById(
    environment: Environment,
    id: string,
  ): Promise<ReconciliationBreakRecord | undefined> {
    const row = [...this.rows.values()].find(
      (candidata) => candidata.id === id && candidata.environment === environment,
    );
    return row ? toRecord(row) : undefined;
  }

  async resolveManually(
    input: Parameters<ReconciliationBreakRepository['resolveManually']>[0],
  ): Promise<ReconciliationBreakRecord | undefined> {
    const row = [...this.rows.values()].find(
      (candidata) => candidata.id === input.id && candidata.environment === input.environment,
    );
    if (!row) return undefined;

    row.status = input.status;
    row.resolution = input.resolution;
    row.resolutionNote = input.note;
    row.resolvedBy = input.resolvedBy;
    row.resolvedAt = input.at;
    row.adjustmentTransactionId = input.adjustmentTransactionId;
    row.assignedTo = input.assignedTo;
    return toRecord(row);
  }

  async countOpenHighSeverity(environment: Environment, accountId: string): Promise<number> {
    return [...this.rows.values()].filter(
      (row) =>
        row.environment === environment &&
        row.accountId === accountId &&
        (row.status === 'OPEN' || row.status === 'INVESTIGATING') &&
        (row.severity === 'HIGH' || row.severity === 'CRITICAL'),
    ).length;
  }

  async list(
    input: Parameters<ReconciliationBreakRepository['list']>[0],
  ): Promise<{ data: ReconciliationBreakRecord[]; nextCursor?: string }> {
    const filtradas = [...this.rows.values()]
      .filter((row) => row.environment === input.environment)
      .filter((row) =>
        input.status
          ? row.status === input.status
          : row.status === 'OPEN' || row.status === 'INVESTIGATING',
      )
      .filter((row) => !input.severity || row.severity === input.severity)
      .filter((row) => !input.type || row.type === input.type)
      .filter((row) => !input.connectionId || row.connectionId === input.connectionId)
      .filter((row) => !input.accountId || row.accountId === input.accountId)
      .filter((row) => input.minAgeDays === undefined || row.ageDays >= input.minAgeDays)
      .sort((a, b) => b.id.localeCompare(a.id))
      .filter((row) => !input.cursor || row.id < input.cursor);

    const data = filtradas.slice(0, input.limit).map(toRecord);
    return {
      data,
      nextCursor: filtradas.length > input.limit ? data.at(-1)?.id : undefined,
    };
  }
}

export class MemoryPollCursorRepository implements PollCursorRepository {
  readonly rows = new Map<string, PollCursorRecord>();

  async ensure(input: Parameters<PollCursorRepository['ensure']>[0]): Promise<PollCursorRecord> {
    const chave = [input.connectionId, input.stream, input.scopeId].join('|');
    const existente = [...this.rows.values()].find(
      (row) => [row.connectionId, row.stream, row.scopeId].join('|') === chave,
    );
    if (existente) return existente;

    const row: PollCursorRecord = { ...input };
    this.rows.set(row.id, row);
    return row;
  }

  async advance(input: { id: string; watermark: Date; cursor?: string; at: Date }): Promise<void> {
    const row = this.rows.get(input.id);
    if (!row) return;
    row.watermark = input.watermark;
    row.cursor = input.cursor;
    row.lastRunAt = input.at;
  }

  async recordFailure(id: string, _error: Record<string, unknown>, at: Date): Promise<void> {
    const row = this.rows.get(id);
    // A marca d'agua NAO se move: a proxima volta refaz a mesma janela.
    if (row) row.lastRunAt = at;
  }

  async listByStream(stream: string): Promise<PollCursorRecord[]> {
    return [...this.rows.values()].filter((row) => row.stream === stream);
  }
}
