import { Prisma } from '@baasconn/db';
import type {
  BreakSeverity,
  BreakStatus,
  BreakType,
  Environment,
  ReconciliationRunStatus,
  ReconciliationScope,
} from '@baasconn/taxonomy';
import { Injectable } from '@nestjs/common';

import type {
  PollCursorRecord,
  PollCursorRepository,
} from '../reconciliation/poll-cursor.types.js';
import type {
  BreakUpsertRow,
  MatchLinkRow,
  ReconciliationBreakRepository,
  ReconciliationItemRow,
  ReconciliationRunRecord,
  ReconciliationRunRepository,
  RunBalances,
  RunCounters,
  UpsertedBreak,
} from '../reconciliation/reconciliation.types.js';

import { PrismaService } from './prisma.service.js';

@Injectable()
export class PrismaReconciliationRunRepository implements ReconciliationRunRepository {
  constructor(private readonly prisma: PrismaService) {}

  async startRun(
    input: Parameters<ReconciliationRunRepository['startRun']>[0],
  ): Promise<{ run: ReconciliationRunRecord; created: boolean }> {
    // `createMany` com `skipDuplicates` e o `ON CONFLICT DO NOTHING` do
    // Prisma: uma ida ao banco, e a corrida entre dois pods e decidida pelo
    // indice unico e nao por um SELECT-entao-INSERT.
    const inserted = await this.prisma.client.reconciliationRun.createMany({
      data: [{ ...input, status: 'QUEUED' as const }],
      skipDuplicates: true,
    });

    const row = await this.prisma.client.reconciliationRun.findUniqueOrThrow({
      where: {
        connectionId_accountId_scope_windowStart_windowEnd: {
          connectionId: input.connectionId,
          accountId: input.accountId,
          scope: input.scope,
          windowStart: input.windowStart,
          windowEnd: input.windowEnd,
        },
      },
    });

    return { run: toRun(row), created: inserted.count === 1 };
  }

  async findById(
    environment: Environment,
    id: string,
  ): Promise<ReconciliationRunRecord | undefined> {
    const row = await this.prisma.client.reconciliationRun.findFirst({
      where: { id, environment },
    });
    return row ? toRun(row) : undefined;
  }

  async markRunning(id: string, at: Date): Promise<void> {
    await this.prisma.client.reconciliationRun.update({
      where: { id },
      data: { status: 'RUNNING', startedAt: at },
    });
  }

  async insertItems(rows: readonly ReconciliationItemRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.prisma.client.reconciliationItem.createMany({
      data: rows.map((row) => ({
        ...row,
        effectiveDate: new Date(`${row.effectiveDate}T00:00:00.000Z`),
        raw: row.raw as never,
      })),
      skipDuplicates: true,
    });
  }

  async linkMatches(rows: readonly MatchLinkRow[]): Promise<void> {
    for (const row of rows) {
      await this.prisma.client.reconciliationItem.update({
        where: { id: row.itemId },
        data: { matchedItemId: row.matchedItemId, matchConfidence: row.confidence },
      });
    }
  }

  async complete(input: {
    id: string;
    status: ReconciliationRunStatus;
    counters: RunCounters;
    balances: RunBalances;
    finishedAt: Date;
  }): Promise<void> {
    await this.prisma.client.reconciliationRun.update({
      where: { id: input.id },
      data: {
        status: input.status,
        ...input.counters,
        ...input.balances,
        finishedAt: input.finishedAt,
      },
    });
  }

  async fail(id: string, error: Record<string, unknown>, finishedAt: Date): Promise<void> {
    await this.prisma.client.reconciliationRun.update({
      where: { id },
      data: { status: 'FAILED', error: error as never, finishedAt },
    });
  }
}

@Injectable()
export class PrismaReconciliationBreakRepository implements ReconciliationBreakRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * SQL cru porque a semantica NAO sai do `upsert` do Prisma.
   *
   * Tres regras que so existem aqui: `first_seen_run_id` fora do `DO UPDATE`,
   * `age_days` derivado do `created_at` da linha EXISTENTE, e `RETURNING
   * (xmax = 0)` para distinguir insercao de atualizacao. O `environment` vai
   * explicito: SQL cru nao passa pela extensao de escopo.
   */
  async upsertMany(rows: readonly BreakUpsertRow[], now: Date): Promise<UpsertedBreak[]> {
    const resultados: UpsertedBreak[] = [];

    for (const row of rows) {
      const efetiva = new Date(`${row.effectiveDate}T00:00:00.000Z`);
      const devolvidas = await this.prisma.client.$queryRaw<
        Array<{ id: string; dedupe_key: string; inserted: boolean }>
      >`
        INSERT INTO reconciliation_break (
          id, environment, run_id, first_seen_run_id, connection_id, account_id,
          type, severity, status, amount_cents, delta_cents, effective_date,
          end_to_end_id, dedupe_key, provider_item_id, local_item_id, ledger_item_id,
          description, evidence, age_days, created_at, updated_at
        ) VALUES (
          ${row.id}, ${row.environment}::"Environment", ${row.runId}, ${row.runId},
          ${row.connectionId}, ${row.accountId},
          ${row.type}::"BreakType", ${row.severity}::"BreakSeverity", 'OPEN'::"BreakStatus",
          ${row.amountCents ?? null}, ${row.deltaCents ?? null}, ${efetiva}::date,
          ${row.endToEndId ?? null}, ${row.dedupeKey},
          ${row.providerItemId ?? null}, ${row.localItemId ?? null}, ${row.ledgerItemId ?? null},
          ${row.description}, ${JSON.stringify(row.evidence)}::jsonb, 0, ${now}, ${now}
        )
        ON CONFLICT (connection_id, type, effective_date, dedupe_key) DO UPDATE SET
          run_id = EXCLUDED.run_id,
          severity = EXCLUDED.severity,
          status = CASE
            -- WRITTEN_OFF permanece: e o operador dizendo "conhecido e aceito".
            WHEN reconciliation_break.status = 'WRITTEN_OFF' THEN reconciliation_break.status
            -- Resolvida que reincide volta a OPEN: o conserto nao pegou, e
            -- isso e informacao nova.
            WHEN reconciliation_break.status IN ('RESOLVED', 'AUTO_RESOLVED')
              THEN 'OPEN'::"BreakStatus"
            ELSE reconciliation_break.status
          END,
          amount_cents = EXCLUDED.amount_cents,
          delta_cents = EXCLUDED.delta_cents,
          provider_item_id = EXCLUDED.provider_item_id,
          local_item_id = EXCLUDED.local_item_id,
          ledger_item_id = EXCLUDED.ledger_item_id,
          description = EXCLUDED.description,
          evidence = EXCLUDED.evidence,
          age_days = GREATEST(
            0,
            DATE_PART('day', ${now}::timestamptz - reconciliation_break.created_at)::int
          ),
          updated_at = ${now}
        RETURNING id, dedupe_key, (xmax = 0) AS inserted`;

      const devolvida = devolvidas[0];
      if (devolvida) {
        resultados.push({
          id: devolvida.id,
          dedupeKey: devolvida.dedupe_key,
          inserted: devolvida.inserted,
        });
      }
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
    const result = await this.prisma.client.reconciliationBreak.updateMany({
      where: {
        environment: input.environment,
        connectionId: input.connectionId,
        accountId: input.accountId,
        effectiveDate: {
          gte: new Date(`${input.fromDate}T00:00:00.000Z`),
          lte: new Date(`${input.toDate}T00:00:00.000Z`),
        },
        status: { in: ['OPEN', 'INVESTIGATING'] },
        dedupeKey: { notIn: [...input.keepDedupeKeys] },
      },
      data: {
        status: 'AUTO_RESOLVED',
        // Sem `resolution`: nenhuma das oito acoes significa "parou de
        // reincidir", e escolher a menos errada mentiria no relatorio.
        resolutionNote: 'Nao reincidiu na execucao seguinte da mesma janela.',
        resolvedBy: 'worker:reconciliation',
        resolvedAt: input.at,
      },
    });
    return result.count;
  }

  async countOpenHighSeverity(environment: Environment, accountId: string): Promise<number> {
    return this.prisma.client.reconciliationBreak.count({
      where: {
        environment,
        accountId,
        status: { in: ['OPEN', 'INVESTIGATING'] },
        severity: { in: ['HIGH', 'CRITICAL'] },
      },
    });
  }

  async listOpen(
    environment: Environment,
    filter: { accountId?: string; status?: BreakStatus; limit: number },
  ): Promise<Array<{ id: string; type: BreakType; severity: BreakSeverity; status: BreakStatus }>> {
    const rows = await this.prisma.client.reconciliationBreak.findMany({
      where: {
        environment,
        accountId: filter.accountId,
        status: filter.status ?? { in: ['OPEN', 'INVESTIGATING'] },
      },
      orderBy: { id: 'desc' },
      take: filter.limit,
      select: { id: true, type: true, severity: true, status: true },
    });
    return rows as Array<{
      id: string;
      type: BreakType;
      severity: BreakSeverity;
      status: BreakStatus;
    }>;
  }
}

function toRun(row: {
  id: string;
  environment: string;
  connectionId: string;
  accountId: string | null;
  scope: string;
  windowStart: Date;
  windowEnd: Date;
  status: string;
  triggeredBy: string;
  createdAt?: Date;
}): ReconciliationRunRecord {
  return {
    id: row.id,
    environment: row.environment as Environment,
    connectionId: row.connectionId,
    accountId: row.accountId ?? '',
    scope: row.scope as ReconciliationScope,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    status: row.status as ReconciliationRunStatus,
    triggeredBy: row.triggeredBy,
    createdAt: row.createdAt ?? row.windowStart,
  };
}

@Injectable()
export class PrismaPollCursorRepository implements PollCursorRepository {
  constructor(private readonly prisma: PrismaService) {}

  async ensure(input: Parameters<PollCursorRepository['ensure']>[0]): Promise<PollCursorRecord> {
    await this.prisma.client.pollCursor.createMany({ data: [input], skipDuplicates: true });
    const row = await this.prisma.client.pollCursor.findUniqueOrThrow({
      where: {
        connectionId_stream_scopeId: {
          connectionId: input.connectionId,
          stream: input.stream,
          scopeId: input.scopeId,
        },
      },
    });
    return toCursor(row);
  }

  async advance(input: { id: string; watermark: Date; cursor?: string; at: Date }): Promise<void> {
    await this.prisma.client.pollCursor.update({
      where: { id: input.id },
      data: {
        watermark: input.watermark,
        cursor: input.cursor ?? null,
        lastRunAt: input.at,
        // NULL do SQL, nao JSON null: sao coisas diferentes na coluna.
        lastError: Prisma.DbNull,
      },
    });
  }

  async recordFailure(id: string, error: Record<string, unknown>, at: Date): Promise<void> {
    await this.prisma.client.pollCursor.update({
      where: { id },
      // A marca d'agua NAO se move aqui: a proxima volta refaz a mesma janela.
      data: { lastRunAt: at, lastError: error as never },
    });
  }

  async listByStream(stream: string): Promise<PollCursorRecord[]> {
    const rows = await this.prisma.client.pollCursor.findMany({
      where: { stream },
      orderBy: { id: 'asc' },
    });
    return rows.map(toCursor);
  }
}

function toCursor(row: {
  id: string;
  connectionId: string;
  stream: string;
  scopeId: string | null;
  cursor: string | null;
  watermark: Date;
  lapSeconds: number;
  lastRunAt: Date | null;
}): PollCursorRecord {
  return {
    id: row.id,
    connectionId: row.connectionId,
    stream: row.stream,
    scopeId: row.scopeId ?? '',
    cursor: row.cursor ?? undefined,
    watermark: row.watermark,
    lapSeconds: row.lapSeconds,
    lastRunAt: row.lastRunAt ?? undefined,
  };
}
