import type { OperationRecord, QueuedJob, ReconcileOutcome } from '@baasconn/api/domain';
import {
  MemoryOperationRepository,
  MemoryReconciliationBreakRepository,
  MemoryReconciliationRunRepository,
} from '@baasconn/api/testing';
import {
  BreakSeverity,
  BreakType,
  Environment,
  FixedClock,
  UNKNOWN_OUTCOME_LADDER_SECONDS,
} from '@baasconn/taxonomy';
import { beforeEach, describe, expect, it } from 'vitest';

import { UnknownOutcomeLadderService } from './ladder.service.js';

const ENV = Environment.HOMOLOGACAO;
const AGORA = new Date('2026-03-11T12:00:00.000Z');

function operacao(overrides: Partial<OperationRecord> = {}): OperationRecord {
  return {
    id: 'opr_1',
    environment: ENV,
    connectionId: 'con_1',
    kind: 'pix.out',
    providerIdempotencyKey: 'opr_1',
    status: 'UNKNOWN',
    requestDigest: 'txn_1',
    accountId: 'acc_1',
    amountCents: 50_000n,
    attempts: 1,
    createdAt: AGORA,
    updatedAt: AGORA,
    ...overrides,
  } as OperationRecord;
}

describe('escada do desfecho desconhecido', () => {
  let operations: MemoryOperationRepository;
  let runs: MemoryReconciliationRunRepository;
  let breaks: MemoryReconciliationBreakRepository;
  let enfileirados: Array<{ job: QueuedJob; delayMs?: number }>;
  let desfecho: ReconcileOutcome;
  let ladder: UnknownOutcomeLadderService;

  beforeEach(async () => {
    operations = new MemoryOperationRepository();
    runs = new MemoryReconciliationRunRepository();
    breaks = new MemoryReconciliationBreakRepository();
    enfileirados = [];
    desfecho = { resolved: false, reason: 'not_found_at_provider' };
    await operations.create(operacao());

    ladder = new UnknownOutcomeLadderService(
      { resolve: async () => desfecho } as never,
      operations,
      runs,
      breaks,
      {
        enqueue: async (job: QueuedJob, options?: { delayMs?: number }) =>
          void enfileirados.push({ job, delayMs: options?.delayMs }),
      } as never,
      new FixedClock(AGORA),
    );
  });

  it('nao encontrado agenda o proximo degrau com o atraso da escada', async () => {
    await ladder.step(ENV, 'opr_1', 0);

    expect(enfileirados).toHaveLength(1);
    expect(enfileirados[0]?.job).toMatchObject({ kind: 'operation_resolve', step: 1 });
    expect(enfileirados[0]?.delayMs).toBe(UNKNOWN_OUTCOME_LADDER_SECONDS[1]! * 1000);
  });

  it('resolvido nao agenda mais nada', async () => {
    desfecho = { resolved: true, status: 'SETTLED', transaction: {} } as never;
    await ladder.step(ENV, 'opr_1', 0);
    expect(enfileirados).toHaveLength(0);
  });

  it('sem capacidade de consulta PARA na hora, nao no degrau 7', async () => {
    // Insistir sete vezes num provedor que nao tem como responder e gastar
    // tempo ate concluir errado.
    desfecho = { resolved: false, reason: 'no_lookup_capability' };
    await ladder.step(ENV, 'opr_1', 0);

    expect(enfileirados).toHaveLength(0);
    expect((await operations.findById(ENV, 'opr_1'))?.status).toBe('FAILED');
  });

  it('ao esgotar, a operacao vai a FAILED e abre quebra CRITICAL', async () => {
    const ultimo = UNKNOWN_OUTCOME_LADDER_SECONDS.length - 1;
    await ladder.step(ENV, 'opr_1', ultimo);

    expect(enfileirados).toHaveLength(0);
    expect((await operations.findById(ENV, 'opr_1'))?.status).toBe('FAILED');

    const quebras = [...breaks.rows.values()];
    expect(quebras).toHaveLength(1);
    expect(quebras[0]).toMatchObject({
      type: BreakType.MISSING_ON_PROVIDER,
      severity: BreakSeverity.CRITICAL,
      dedupeKey: 'opr:opr_1',
    });
  });

  it('a quebra do esgotamento pendura num run sintetico, nunca sem accountId', async () => {
    // `ReconciliationBreak.runId` e FK obrigatoria; e `accountId` NULL
    // escaparia da chave unica do run.
    await ladder.step(ENV, 'opr_1', UNKNOWN_OUTCOME_LADDER_SECONDS.length - 1);

    const run = [...runs.runs.values()][0];
    expect(run?.triggeredBy).toBe('worker:unknown-outcome-ladder');
    expect(run?.accountId).toBe('acc_1');
  });

  it('esgotar NAO toca transacao nenhuma', async () => {
    // A linha mais perigosa do marco: levar a `Transaction` a FAILED
    // dispararia `voidOut` e devolveria ao cliente um saldo que talvez ja
    // tenha saido da conta dele no provedor — ele gastaria duas vezes o mesmo
    // dinheiro, e a segunda seria culpa nossa.
    //
    // A garantia e ESTRUTURAL: o servico nao recebe repositorio de transacao
    // nem razao, entao nao tem como tocar um. A assercao de aridade e o
    // arame de tropeco — acrescentar a dependencia quebra este teste, e quem
    // o consertar tera de ler o comentario acima antes.
    const DEPENDENCIAS_SEM_TRANSACAO = 6;
    expect(UnknownOutcomeLadderService.length).toBe(DEPENDENCIAS_SEM_TRANSACAO);

    await ladder.step(ENV, 'opr_1', UNKNOWN_OUTCOME_LADDER_SECONDS.length - 1);
    expect((await operations.findById(ENV, 'opr_1'))?.status).toBe('FAILED');
  });

  it('a varredura retoma do degrau ja alcancado, nao do zero', async () => {
    // Reenfileirar sempre no zero faria uma operacao presa refazer a escada
    // inteira a cada 30 segundos.
    await operations.create(operacao({ id: 'opr_2', attempts: 4 }));
    const total = await ladder.sweepStuck(ENV);

    expect(total).toBeGreaterThanOrEqual(2);
    expect(enfileirados.map((e) => e.job)).toContainEqual(
      expect.objectContaining({ operationId: 'opr_2', step: 4 }),
    );
  });

  it('a varredura pula o que ainda nao venceu', async () => {
    await operations.create(
      operacao({ id: 'opr_3', nextTryAt: new Date(AGORA.getTime() + 60_000) }),
    );
    const ids = (await ladder.sweepStuck(ENV), enfileirados.map((e) => e.job)) as Array<{
      operationId?: string;
    }>;
    expect(ids.some((job) => job.operationId === 'opr_3')).toBe(false);
  });
});
