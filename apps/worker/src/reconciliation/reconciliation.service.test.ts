import type { AccountRecord, ReconciliationRunRecord } from '@baasconn/api/domain';
import {
  MemoryOutboxRepository,
  MemoryReconciliationBreakRepository,
  MemoryReconciliationRunRepository,
  MemoryTransactionRepository,
} from '@baasconn/api/testing';
import { Metrics } from '@baasconn/observability';
import type { StatementEntry, StatementPage } from '@baasconn/provider-spi';
import {
  AccountStatus,
  BreakType,
  Environment,
  EventType,
  FixedClock,
  ReconciliationRunStatus,
  ReconciliationScope,
  StatementEntryType,
} from '@baasconn/taxonomy';
import { beforeEach, describe, expect, it } from 'vitest';

import { ReconciliationService } from './reconciliation.service.js';

const AGORA = new Date('2026-03-11T12:00:00.000Z');
const CONTA: AccountRecord = {
  id: 'acc_1',
  environment: Environment.HOMOLOGACAO,
  status: AccountStatus.ACTIVE,
  providerConnectionId: 'con_1',
  providerAccountId: 'mb-1',
  ledgerAvailableAccountId: 'lac_disp',
} as AccountRecord;

function entrada(overrides: Partial<StatementEntry> = {}): StatementEntry {
  return {
    providerEntryId: 'MB-1',
    postedAt: '2026-03-10T13:00:00.000Z',
    effectiveDate: '2026-03-10',
    direction: 'credit',
    amount: { amount: '150000', currency: 'BRL', scale: 2 },
    type: StatementEntryType.PIX_IN,
    endToEndId: 'E1801234520260310100011111111',
    ...overrides,
  };
}

describe('execucao de conciliacao', () => {
  let runs: MemoryReconciliationRunRepository;
  let breaks: MemoryReconciliationBreakRepository;
  let outbox: MemoryOutboxRepository;
  let paginas: StatementPage[];
  let resolvidas: number;
  let service: ReconciliationService;
  let run: ReconciliationRunRecord;

  beforeEach(async () => {
    runs = new MemoryReconciliationRunRepository();
    breaks = new MemoryReconciliationBreakRepository();
    outbox = new MemoryOutboxRepository();
    resolvidas = 0;
    paginas = [
      { data: [entrada()], hasMore: false, openingBalance: undefined, closingBalance: undefined },
    ];

    const criado = await runs.startRun({
      id: 'rec_1',
      environment: Environment.HOMOLOGACAO,
      connectionId: 'con_1',
      accountId: CONTA.id,
      scope: ReconciliationScope.DAILY,
      windowStart: new Date('2026-03-10T00:00:00.000Z'),
      windowEnd: new Date('2026-03-10T23:59:59.999Z'),
      triggeredBy: 'teste',
    });
    run = criado.run;

    let chamada = 0;
    service = new ReconciliationService(
      {
        resolve: async () => ({
          slug: 'MOCK_BANK',
          adapter: { statement: { list: async () => paginas[chamada++] ?? paginas.at(-1)! } },
        }),
      } as never,
      { movements: async () => [], balances: async () => ({ posted: 0n }) } as never,
      { applyAll: async () => ++resolvidas } as never,
      new Metrics(),
      runs,
      breaks,
      { findById: async () => CONTA } as never,
      new MemoryTransactionRepository(),
      outbox,
      new FixedClock(AGORA),
    );
  });

  it('credito so no provedor abre MISSING_ON_LOCAL e emite evento uma vez', async () => {
    await service.run(Environment.HOMOLOGACAO, run.id);

    const abertas = [...breaks.rows.values()];
    expect(abertas).toHaveLength(1);
    expect(abertas[0]?.type).toBe(BreakType.MISSING_ON_LOCAL);
    expect(
      outbox.rows.filter((row) => row.type === EventType.RECONCILIATION_BREAK_OPENED),
    ).toHaveLength(1);
  });

  it('reincidir NAO emite o evento de novo', async () => {
    // A intraday roda a cada 30 min: reemitir faria o cliente receber a mesma
    // quebra 48 vezes por dia.
    await service.run(Environment.HOMOLOGACAO, run.id);
    const segundo = await runs.startRun({
      id: 'rec_2',
      environment: Environment.HOMOLOGACAO,
      connectionId: 'con_1',
      accountId: CONTA.id,
      scope: ReconciliationScope.INTRADAY,
      windowStart: new Date('2026-03-10T00:00:00.000Z'),
      windowEnd: new Date('2026-03-10T23:59:59.999Z'),
      triggeredBy: 'teste',
    });
    await service.run(Environment.HOMOLOGACAO, segundo.run.id);

    expect(
      outbox.rows.filter((row) => row.type === EventType.RECONCILIATION_BREAK_OPENED),
    ).toHaveLength(1);
  });

  it('a quebra que para de reincidir e fechada', async () => {
    await service.run(Environment.HOMOLOGACAO, run.id);
    expect([...breaks.rows.values()][0]?.status).toBe('OPEN');

    paginas = [{ data: [], hasMore: false }];
    const segundo = await runs.startRun({
      id: 'rec_3',
      environment: Environment.HOMOLOGACAO,
      connectionId: 'con_1',
      accountId: CONTA.id,
      scope: ReconciliationScope.INTRADAY,
      windowStart: new Date('2026-03-10T00:00:00.000Z'),
      windowEnd: new Date('2026-03-10T23:59:59.999Z'),
      triggeredBy: 'teste',
    });
    await service.run(Environment.HOMOLOGACAO, segundo.run.id);

    // Sem o fechamento o painel nunca esvazia e o operador para de acreditar.
    expect([...breaks.rows.values()][0]?.status).toBe('AUTO_RESOLVED');
  });

  it('segue o cursor ate o fim do extrato', async () => {
    // Ignorar `hasMore` trunca a janela em silencio e inventa quebra.
    paginas = [
      { data: [entrada()], hasMore: true, nextCursor: 'c1' },
      { data: [entrada({ providerEntryId: 'MB-2', endToEndId: undefined })], hasMore: false },
    ];
    await service.run(Environment.HOMOLOGACAO, run.id);

    const executado = await runs.findById(Environment.HOMOLOGACAO, run.id);
    expect(executado?.counters?.providerItemCount).toBe(2);
  });

  it('adapter sem extrato FALHA o run, nunca conclui em silencio', async () => {
    service = new ReconciliationService(
      { resolve: async () => ({ slug: 'MOCK_BANK', adapter: {} }) } as never,
      { movements: async () => [], balances: async () => ({ posted: 0n }) } as never,
      { applyAll: async () => 0 } as never,
      new Metrics(),
      runs,
      breaks,
      { findById: async () => CONTA } as never,
      new MemoryTransactionRepository(),
      outbox,
      new FixedClock(AGORA),
    );

    await service.run(Environment.HOMOLOGACAO, run.id);
    const executado = await runs.findById(Environment.HOMOLOGACAO, run.id);
    expect(executado?.status).toBe(ReconciliationRunStatus.FAILED);
    expect(runs.failures.get(run.id)).toEqual({ reason: 'no_statement_facet' });
  });

  it('roda a auto-resolucao depois de persistir, nao antes', async () => {
    await service.run(Environment.HOMOLOGACAO, run.id);
    expect(resolvidas).toBe(1);
  });
});
