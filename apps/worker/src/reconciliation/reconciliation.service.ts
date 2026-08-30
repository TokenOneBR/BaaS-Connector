import {
  ACCOUNT_REPOSITORY,
  CLOCK,
  OUTBOX_REPOSITORY,
  RECONCILIATION_BREAK_REPOSITORY,
  RECONCILIATION_RUN_REPOSITORY,
  ShadowLedgerService,
  TRANSACTION_REPOSITORY,
  Metrics,
  ProviderResolver,
  type AccountRecord,
  type BreakUpsertRow,
  type MatchLinkRow,
  type OutboxRepository,
  type ReconciliationBreakRepository,
  type ReconciliationItemRow,
  type ReconciliationRunRecord,
  type ReconciliationRunRepository,
  type TransactionRepository,
  type AccountRepository,
} from '@baasconn/api/domain';
import type { StatementEntry } from '@baasconn/provider-spi';
import {
  BrazilianBankCalendar,
  reconcile,
  type NormalizedItem,
  type ReconciliationPolicy,
  type ReconciliationResult,
} from '@baasconn/reconciliation';
import {
  BreakSeverity,
  EventType,
  ReconciliationRunStatus,
  ReconciliationSide,
  newId,
  type Clock,
  type Environment,
} from '@baasconn/taxonomy';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { AutoResolutionService } from './auto-resolution.service.js';
import {
  RECONCILIATION_STATUSES,
  fromLedgerMovement,
  fromStatementEntry,
  fromTransaction,
  mirrorsProviderMovement,
} from './normalizers.js';

/** Teto de paginas do extrato. Um provedor em laco nao pode travar o worker. */
const MAX_STATEMENT_PAGES = 50;
const STATEMENT_PAGE_SIZE = 200;
const LOCAL_PAGE_SIZE = 500;

/**
 * Politica padrao.
 *
 * Vem daqui e nao do motor porque e decisao de PRODUTO — quanto de deriva
 * toleramos — e o motor precisa continuar puro para um provedor com
 * calendario proprio poder substituir o dele.
 */
export const DEFAULT_POLICY: Omit<ReconciliationPolicy, 'calendar'> = Object.freeze({
  settlementGraceMinutes: 120,
  amountToleranceCents: 1n,
  amountToleranceBasisPoints: 1n,
  dateToleranceBusinessDays: 2,
  autoResolveDateWithinBusinessDays: 1,
  criticalAmountDeltaCents: 1n,
  maxGreedyPairs: 20,
});

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);
  private readonly calendar = new BrazilianBankCalendar();

  constructor(
    private readonly providers: ProviderResolver,
    private readonly ledger: ShadowLedgerService,
    private readonly autoResolution: AutoResolutionService,
    private readonly metrics: Metrics,
    @Inject(RECONCILIATION_RUN_REPOSITORY) private readonly runs: ReconciliationRunRepository,
    @Inject(RECONCILIATION_BREAK_REPOSITORY) private readonly breaks: ReconciliationBreakRepository,
    @Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository,
    @Inject(TRANSACTION_REPOSITORY) private readonly transactions: TransactionRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Executa um run ja criado. O job carrega so o id. */
  async run(environment: Environment, runId: string): Promise<void> {
    const run = await this.runs.findById(environment, runId);
    if (!run) return;
    if (run.status !== ReconciliationRunStatus.QUEUED) return;

    const inicio = process.hrtime.bigint();
    await this.runs.markRunning(run.id, this.clock.now());

    try {
      await this.execute(run);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.runs.fail(run.id, { message }, this.clock.now());
      this.logger.error({ err: error, run_id: run.id }, 'Conciliacao falhou');
      throw error;
    } finally {
      const segundos = Number(process.hrtime.bigint() - inicio) / 1e9;
      this.metrics.reconciliationRunDuration.observe(
        { provider: 'unknown', scope: run.scope },
        segundos,
      );
    }
  }

  private async execute(run: ReconciliationRunRecord): Promise<void> {
    const account = await this.accounts.findById(run.environment, run.accountId);
    if (!account) {
      await this.runs.fail(run.id, { reason: 'account_not_found' }, this.clock.now());
      return;
    }

    const bound = await this.providers.resolve(run.connectionId);
    if (!bound.adapter.statement) {
      // FAILED com motivo, nunca COMPLETED em silencio: um run "concluido"
      // sem ter lido o provedor diria ao operador que esta tudo conferido.
      await this.runs.fail(run.id, { reason: 'no_statement_facet' }, this.clock.now());
      this.logger.warn({ run_id: run.id, provider: bound.slug }, 'Adapter sem extrato');
      return;
    }

    const { entries, openingCents, closingCents } = await this.fetchProvider(
      bound.adapter.statement,
      account,
      run,
    );

    const provider = entries.map((entry) => fromStatementEntry(entry, account.id));
    const local = await this.fetchLocal(run, account);
    const ledger = await this.fetchLedger(run, account);
    const ledgerClosingCents = account.ledgerAvailableAccountId
      ? (await this.ledger.balances(run.environment, account.ledgerAvailableAccountId)).posted
      : undefined;

    const resultado = reconcile({
      runId: run.id,
      environment: run.environment,
      connectionId: run.connectionId,
      accountId: account.id,
      scope: run.scope,
      window: { start: run.windowStart, end: run.windowEnd },
      now: this.clock.now(),
      provider,
      local,
      ledger,
      balances: {
        providerOpeningCents: openingCents,
        providerClosingCents: closingCents,
        ledgerClosingCents,
      },
      policy: { ...DEFAULT_POLICY, calendar: this.calendar },
    });

    await this.persist(run, [...provider, ...local, ...ledger], resultado);
    await this.autoResolution.applyAll({
      run,
      account,
      provider: bound,
      breaks: resultado.breaks,
      rawByItemId: new Map(entries.map((entry, i) => [provider[i]!.id, entry])),
    });

    this.reportMetrics(bound.slug, resultado, ledgerClosingCents, closingCents);
  }

  private async fetchProvider(
    facet: NonNullable<Awaited<ReturnType<ProviderResolver['resolve']>>['adapter']['statement']>,
    account: AccountRecord,
    run: ReconciliationRunRecord,
  ): Promise<{ entries: StatementEntry[]; openingCents?: bigint; closingCents?: bigint }> {
    const ref = { providerAccountId: account.providerAccountId! };
    const from = toDay(run.windowStart);
    const to = toDay(run.windowEnd);

    const entries: StatementEntry[] = [];
    let cursor: string | undefined;
    let openingCents: bigint | undefined;
    let closingCents: bigint | undefined;

    for (let pagina = 0; pagina < MAX_STATEMENT_PAGES; pagina += 1) {
      const page = await facet.list(ref, { from, to, limit: STATEMENT_PAGE_SIZE, cursor });
      entries.push(...page.data);

      // Saldos sao da JANELA: a primeira pagina que os traz manda.
      openingCents ??= page.openingBalance ? BigInt(page.openingBalance.amount) : undefined;
      closingCents ??= page.closingBalance ? BigInt(page.closingBalance.amount) : undefined;

      // Ignorar `hasMore` trunca a janela em SILENCIO e produz
      // `MISSING_ON_LOCAL` fantasma — quebra inventada e pior que quebra
      // nenhuma, porque custa a confianca no painel inteiro.
      if (!page.hasMore || !page.nextCursor) break;
      cursor = page.nextCursor;
    }

    return { entries, openingCents, closingCents };
  }

  private async fetchLocal(
    run: ReconciliationRunRecord,
    account: AccountRecord,
  ): Promise<NormalizedItem[]> {
    const itens: NormalizedItem[] = [];
    let cursor: { date: string; id: string } | undefined;

    for (let pagina = 0; pagina < MAX_STATEMENT_PAGES; pagina += 1) {
      const page = await this.transactions.statement({
        environment: run.environment,
        accountId: account.id,
        from: toDay(run.windowStart),
        to: toDay(run.windowEnd),
        statuses: RECONCILIATION_STATUSES,
        limit: LOCAL_PAGE_SIZE,
        cursor,
      });
      itens.push(...page.data.map(fromTransaction));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    return itens;
  }

  private async fetchLedger(
    run: ReconciliationRunRecord,
    account: AccountRecord,
  ): Promise<NormalizedItem[]> {
    // SO a conta disponivel. A bloqueada nao tem contraparte no provedor, e
    // incluí-la faria todo bloqueio judicial virar um `MISSING_ON_LOCAL`
    // CRITICAL falso.
    if (!account.ledgerAvailableAccountId) return [];

    const movimentos = await this.ledger.movements(
      run.environment,
      account.ledgerAvailableAccountId,
      run.windowStart,
      run.windowEnd,
    );

    return movimentos
      .filter((movimento) => mirrorsProviderMovement(movimento.type))
      .map((movimento) => fromLedgerMovement(movimento, account.id));
  }

  private async persist(
    run: ReconciliationRunRecord,
    itens: readonly NormalizedItem[],
    resultado: ReconciliationResult,
  ): Promise<void> {
    await this.runs.insertItems(itens.map((item) => toItemRow(run.id, item)));

    const links: MatchLinkRow[] = [];
    for (const match of resultado.matches) {
      if (!match.providerItemId || !match.localItemId) continue;
      links.push({
        itemId: match.providerItemId,
        matchedItemId: match.localItemId,
        confidence: match.confidence,
      });
      links.push({
        itemId: match.localItemId,
        matchedItemId: match.providerItemId,
        confidence: match.confidence,
      });
    }
    await this.runs.linkMatches(links);

    const now = this.clock.now();
    const rows: BreakUpsertRow[] = resultado.breaks.map((draft) => ({
      id: newId('reconciliationBreak'),
      environment: run.environment,
      runId: run.id,
      connectionId: run.connectionId,
      accountId: run.accountId,
      type: draft.type,
      severity: draft.severity,
      dedupeKey: draft.dedupeKey,
      effectiveDate: draft.effectiveDate,
      endToEndId: draft.endToEndId,
      amountCents: draft.amountCents,
      deltaCents: draft.deltaCents,
      providerItemId: draft.providerItemId,
      localItemId: draft.localItemId,
      ledgerItemId: draft.ledgerItemId,
      description: draft.description,
      evidence: draft.evidence as Record<string, unknown>,
    }));

    const gravadas = await this.breaks.upsertMany(rows, now);

    for (const gravada of gravadas) {
      // So a INSERCAO emite evento. Reemitir a cada execucao faria o cliente
      // receber a mesma quebra 48 vezes por dia com a intraday de 30 min.
      if (!gravada.inserted) continue;
      await this.outbox.append({
        environment: run.environment,
        type: EventType.RECONCILIATION_BREAK_OPENED,
        connectionId: run.connectionId,
        subjectKind: 'reconciliation_break',
        subjectId: gravada.id,
        payload: { run_id: run.id, dedupe_key: gravada.dedupeKey },
        occurredAt: now,
      });
    }

    await this.breaks.closeNotRecurring({
      environment: run.environment,
      connectionId: run.connectionId,
      accountId: run.accountId,
      fromDate: toDay(run.windowStart),
      toDate: toDay(run.windowEnd),
      keepDedupeKeys: rows.map((row) => row.dedupeKey),
      at: now,
    });

    await this.runs.complete({
      id: run.id,
      status:
        resultado.breaks.length > 0
          ? ReconciliationRunStatus.COMPLETED_WITH_BREAKS
          : ReconciliationRunStatus.COMPLETED,
      counters: resultado.counters,
      balances: {
        providerOpeningBalanceCents: resultado.balance.openingCents,
        providerClosingBalanceCents: resultado.balance.providerClosingCents,
        ledgerClosingBalanceCents: resultado.balance.ledgerClosingCents,
        balanceDeltaCents: resultado.balance.balanceDeltaCents,
      },
      finishedAt: now,
    });
  }

  private reportMetrics(
    provider: string,
    resultado: ReconciliationResult,
    ledgerClosingCents?: bigint,
    providerClosingCents?: bigint,
  ): void {
    for (const severidade of Object.values(BreakSeverity)) {
      const doNivel = resultado.breaks.filter((quebra) => quebra.severity === severidade);
      const porTipo = new Map<string, number>();
      for (const quebra of doNivel) {
        porTipo.set(quebra.type, (porTipo.get(quebra.type) ?? 0) + 1);
      }
      for (const [tipo, total] of porTipo) {
        this.metrics.reconciliationBreaksOpen.set(
          { provider, break_type: tipo, severity: severidade },
          total,
        );
      }
    }

    if (ledgerClosingCents !== undefined && providerClosingCents !== undefined) {
      const delta = providerClosingCents - ledgerClosingCents;
      this.metrics.balanceDriftMinor.set(
        { provider, account_kind: 'available' },
        Number(delta < 0n ? -delta : delta),
      );
    }

    this.metrics.reconciliationLastSuccess.set({ provider }, this.clock.now().getTime() / 1000);
  }
}

function toDay(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

function toItemRow(runId: string, item: NormalizedItem): ReconciliationItemRow {
  return {
    id: item.id,
    runId,
    side: item.side as ReconciliationSide,
    externalId: item.externalId,
    endToEndId: item.endToEndId,
    postedAt: item.postedAt,
    effectiveDate: item.effectiveDate,
    direction: item.direction,
    amountCents: item.amountCents,
    type: item.type,
    counterpartyTaxIdIndex: item.counterpartyTaxIdIndex,
    matchKeyStrong: item.matchKeyStrong,
    matchKeyFuzzy: item.matchKeyFuzzy,
    raw: item.raw as Record<string, unknown>,
  };
}
