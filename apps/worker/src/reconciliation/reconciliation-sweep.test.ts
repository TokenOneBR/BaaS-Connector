import type { AccountRecord, QueuedJob, StoredConnection } from '@baasconn/api/domain';
import { MemoryReconciliationRunRepository } from '@baasconn/api/testing';
import { AccountStatus, Environment, FixedClock, ReconciliationScope } from '@baasconn/taxonomy';
import { beforeEach, describe, expect, it } from 'vitest';

import { ReconciliationSweepService } from './reconciliation-sweep.service.js';

const CONEXAO: StoredConnection = {
  id: 'con_1',
  environment: Environment.HOMOLOGACAO,
  provider: 'MOCK_BANK',
  status: 'ACTIVE',
  config: {},
  credentials: {} as never,
};

function conta(id: string, overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    id,
    environment: Environment.HOMOLOGACAO,
    status: AccountStatus.ACTIVE,
    providerConnectionId: 'con_1',
    providerAccountId: `mb-${id}`,
    ...overrides,
  } as AccountRecord;
}

describe('varredura de conciliacao', () => {
  let runs: MemoryReconciliationRunRepository;
  let enfileirados: QueuedJob[];
  let contas: AccountRecord[];
  let sweep: ReconciliationSweepService;

  beforeEach(() => {
    runs = new MemoryReconciliationRunRepository();
    enfileirados = [];
    contas = [conta('acc_1'), conta('acc_2')];

    const clock = new FixedClock(new Date('2026-03-11T06:00:00.000Z'));
    sweep = new ReconciliationSweepService(
      { listActive: async () => [CONEXAO] } as never,
      {
        list: async (filter: { limit: number }) => ({
          data: contas.slice(0, filter.limit),
          nextCursor: undefined,
        }),
      } as never,
      runs,
      { enqueue: async (job: QueuedJob) => void enfileirados.push(job) } as never,
      clock,
    );
  });

  it('cria um run por conta e enfileira a execucao', () => {
    return sweep.sweep(ReconciliationScope.DAILY).then((criados) => {
      expect(criados).toBe(2);
      expect(runs.runs.size).toBe(2);
      expect(enfileirados).toHaveLength(2);
      expect(enfileirados.every((job) => job.kind === 'reconciliation')).toBe(true);
    });
  });

  it('nenhum run nasce com accountId vazio', async () => {
    // Em Postgres NULL nao e igual a NULL num indice unico: um run de
    // conexao inteira escaparia da deduplicacao, e duas varreduras
    // concorrentes criariam duas execucoes da mesma janela.
    await sweep.sweep(ReconciliationScope.DAILY);
    for (const run of runs.runs.values()) {
      expect(run.accountId).toBeTruthy();
    }
  });

  it('varrer duas vezes a mesma janela nao cria run nem job novo', async () => {
    await sweep.sweep(ReconciliationScope.DAILY);
    const criadosNaSegunda = await sweep.sweep(ReconciliationScope.DAILY);

    expect(criadosNaSegunda).toBe(0);
    expect(runs.runs.size).toBe(2);
    expect(enfileirados).toHaveLength(2);
  });

  it('conta sem id no provedor e pulada, nao falha a varredura', async () => {
    contas = [conta('acc_1'), conta('acc_sem', { providerAccountId: undefined })];
    const criados = await sweep.sweep(ReconciliationScope.DAILY);
    expect(criados).toBe(1);
  });

  it('a janela diaria e o dia anterior inteiro em Brasilia', async () => {
    // 06:00 UTC de 11/03 e 03:00 em Brasilia do dia 11: a janela e o dia 10.
    await sweep.sweep(ReconciliationScope.DAILY);
    const run = [...runs.runs.values()][0]!;
    expect(run.windowStart.toISOString()).toBe('2026-03-10T00:00:00.000Z');
    expect(run.windowEnd.toISOString()).toBe('2026-03-10T23:59:59.999Z');
  });

  it('a janela intraday olha as ultimas horas, e nao o dia', async () => {
    await sweep.sweep(ReconciliationScope.INTRADAY);
    const run = [...runs.runs.values()][0]!;
    expect(run.windowEnd.toISOString()).toBe('2026-03-11T06:00:00.000Z');
    expect(run.windowStart.toISOString()).toBe('2026-03-11T02:00:00.000Z');
  });
});
