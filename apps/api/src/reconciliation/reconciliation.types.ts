import type {
  BreakSeverity,
  BreakStatus,
  BreakType,
  Environment,
  MatchConfidence,
  ReconciliationRunStatus,
  ReconciliationScope,
  ReconciliationSide,
  ResolutionAction,
} from '@baasconn/taxonomy';

export const RECONCILIATION_RUN_REPOSITORY = Symbol('BAAS_RECONCILIATION_RUN_REPOSITORY');
export const RECONCILIATION_BREAK_REPOSITORY = Symbol('BAAS_RECONCILIATION_BREAK_REPOSITORY');

export interface ReconciliationRunRecord {
  id: string;
  environment: Environment;
  connectionId: string;
  accountId: string;
  scope: ReconciliationScope;
  windowStart: Date;
  windowEnd: Date;
  status: ReconciliationRunStatus;
  triggeredBy: string;
  createdAt: Date;
  /**
   * Contadores e saldos, hoje SOMENTE-ESCRITA.
   *
   * `complete()` grava os seis; o record nao carregava nenhum e nao havia
   * `list()`. O `balanceDeltaCents` esta descrito no contrato como "numero de
   * manchete do dashboard" e era ilegivel.
   */
  counters?: RunCounters;
  balances?: RunBalances;
  startedAt?: Date;
  finishedAt?: Date;
}

export interface ReconciliationItemRow {
  id: string;
  runId: string;
  side: ReconciliationSide;
  externalId?: string;
  endToEndId?: string;
  postedAt: Date;
  effectiveDate: string;
  direction: string;
  amountCents: bigint;
  type: string;
  counterpartyTaxIdIndex?: string;
  matchKeyStrong?: string;
  matchKeyFuzzy: string;
  raw: Record<string, unknown>;
}

export interface MatchLinkRow {
  itemId: string;
  matchedItemId: string;
  confidence: MatchConfidence;
}

export interface RunCounters {
  providerItemCount: number;
  localItemCount: number;
  ledgerItemCount: number;
  matchedCount: number;
  breakCount: number;
}

export interface RunBalances {
  providerOpeningBalanceCents?: bigint;
  providerClosingBalanceCents?: bigint;
  ledgerClosingBalanceCents?: bigint;
  balanceDeltaCents?: bigint;
}

/**
 * Run e itens.
 *
 * Uma porta so para os dois porque o item e filho `onDelete: Cascade` e nao
 * tem vida propria: nasce e morre com a execucao. A quebra tem porta separada
 * porque SOBREVIVE ao run — e resolvida por humano dias depois, e e lida
 * sozinha pelo bypass de cache de saldo.
 */
export interface ReconciliationRunRepository {
  /**
   * Cria a execucao, ou devolve a que ja existe para a mesma janela.
   *
   * `created: false` significa que outro pod ja pegou esta janela. A chave
   * unica e `(conexao, conta, escopo, inicio, fim)`, e o `accountId` NUNCA e
   * nulo: em Postgres NULL nao e igual a NULL num indice unico, entao um run
   * de conexao inteira escaparia da deduplicacao — o mesmo defeito que a
   * migration de dedup de quebra corrigiu.
   */
  startRun(input: {
    id: string;
    environment: Environment;
    connectionId: string;
    accountId: string;
    scope: ReconciliationScope;
    windowStart: Date;
    windowEnd: Date;
    triggeredBy: string;
  }): Promise<{ run: ReconciliationRunRecord; created: boolean }>;
  findById(environment: Environment, id: string): Promise<ReconciliationRunRecord | undefined>;
  list(input: {
    environment: Environment;
    connectionId?: string;
    accountId?: string;
    status?: ReconciliationRunStatus;
    limit: number;
    cursor?: string;
  }): Promise<{ data: ReconciliationRunRecord[]; nextCursor?: string }>;
  /**
   * Le um item pelo id de `reconciliation_item`.
   *
   * A quebra guarda `localItemId`/`providerItemId`/`ledgerItemId`, que sao ids
   * de ITEM (`rci_`), nunca de transacao. Quem precisa agir sobre o registro
   * local — a resolucao manual, a tela lado a lado — passa por aqui para
   * chegar ao `externalId`, que no lado LOCAL e o id da transacao. Tratar o
   * id do item como id de transacao acharia zero linhas e o cancelamento
   * falharia com "transicao ilegal" em vez de agir.
   */
  findItemById(id: string): Promise<ReconciliationItemRow | undefined>;
  markRunning(id: string, at: Date): Promise<void>;
  insertItems(rows: readonly ReconciliationItemRow[]): Promise<void>;
  /** Grava o par casado nos DOIS lados, para a tela ler de qualquer um. */
  linkMatches(rows: readonly MatchLinkRow[]): Promise<void>;
  complete(input: {
    id: string;
    status: ReconciliationRunStatus;
    counters: RunCounters;
    balances: RunBalances;
    finishedAt: Date;
  }): Promise<void>;
  fail(id: string, error: Record<string, unknown>, finishedAt: Date): Promise<void>;
}

export interface BreakUpsertRow {
  id: string;
  environment: Environment;
  runId: string;
  connectionId: string;
  accountId: string;
  type: BreakType;
  severity: BreakSeverity;
  dedupeKey: string;
  effectiveDate: string;
  endToEndId?: string;
  amountCents?: bigint;
  deltaCents?: bigint;
  providerItemId?: string;
  localItemId?: string;
  ledgerItemId?: string;
  description: string;
  evidence: Record<string, unknown>;
}

export interface UpsertedBreak {
  id: string;
  dedupeKey: string;
  /** `xmax = 0`: a linha nasceu agora. So a insercao emite evento. */
  inserted: boolean;
}

export interface ReconciliationBreakRecord {
  id: string;
  environment: Environment;
  runId: string;
  firstSeenRunId: string;
  connectionId: string;
  accountId?: string;
  type: BreakType;
  severity: BreakSeverity;
  status: BreakStatus;
  dedupeKey: string;
  effectiveDate: string;
  endToEndId?: string;
  amountCents?: bigint;
  deltaCents?: bigint;
  providerItemId?: string;
  localItemId?: string;
  ledgerItemId?: string;
  description: string;
  /**
   * Os dois lados normalizados e redigidos, para revisao lado a lado.
   *
   * A coluna e `Json NOT NULL` desde a primeira migration e o contrato a
   * declara obrigatoria, mas o mapper nao a copiava — entao a tela lado a
   * lado, que e o motivo de a conciliacao ter interface, nao tinha fonte de
   * dados. `respond()` passa a reprovar a resposta que a omitir.
   */
  evidence: Record<string, unknown>;
  ageDays: number;
  resolution?: ResolutionAction;
  resolutionNote?: string;
  resolvedBy?: string;
  resolvedAt?: Date;
  adjustmentTransactionId?: string;
  assignedTo?: string;
  createdAt: Date;
}

export interface ReconciliationBreakRepository {
  /**
   * Insere ou reabre, pela chave derivada de dedup.
   *
   * `firstSeenRunId` fica FORA do `DO UPDATE`: copia-lo de `EXCLUDED` zeraria
   * a idade a cada execucao, e uma quebra de 30 dias se apresentaria como
   * nova — o SLA de envelhecimento nunca dispararia.
   */
  upsertMany(rows: readonly BreakUpsertRow[], now: Date): Promise<UpsertedBreak[]>;
  /**
   * Fecha o que NAO reincidiu, escopado pela janela examinada.
   *
   * Sem o escopo, fecharia quebra que a execucao nem olhou. Sem o
   * fechamento, o painel nunca esvazia e o operador para de acreditar nele.
   */
  closeNotRecurring(input: {
    environment: Environment;
    connectionId: string;
    accountId: string;
    fromDate: string;
    toDate: string;
    keepDedupeKeys: readonly string[];
    at: Date;
  }): Promise<number>;
  findById(environment: Environment, id: string): Promise<ReconciliationBreakRecord | undefined>;
  /**
   * Resolucao manual.
   *
   * APENAS ANEXA: grava quem resolveu, com que acao, com que justificativa e —
   * quando houve — o id do lancamento de ajuste. Nao existe metodo para editar
   * a quebra original nem o lancamento, porque nao existe permissao para isso:
   * `ledger_entry_no_mutation` e o `REVOKE` recusam.
   */
  resolveManually(input: {
    environment: Environment;
    id: string;
    status: BreakStatus;
    resolution: ResolutionAction;
    note: string;
    resolvedBy: string;
    adjustmentTransactionId?: string;
    assignedTo?: string;
    at: Date;
  }): Promise<ReconciliationBreakRecord | undefined>;
  /** Alimenta a regra 5 de bypass do cache de saldo. */
  countOpenHighSeverity(environment: Environment, accountId: string): Promise<number>;
  /**
   * Listagem para o painel.
   *
   * Os filtros sao os que `zListBreaksQuery` ja declara — filtrar em memoria o
   * que o indice `[environment, status, severity, effectiveDate]` resolve
   * seria trazer a tabela inteira para descartar quase tudo.
   */
  list(input: {
    environment: Environment;
    status?: BreakStatus;
    severity?: BreakSeverity;
    type?: BreakType;
    connectionId?: string;
    accountId?: string;
    minAgeDays?: number;
    limit: number;
    cursor?: string;
  }): Promise<{ data: ReconciliationBreakRecord[]; nextCursor?: string }>;
}
