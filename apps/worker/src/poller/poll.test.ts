import type { AccountRecord, InboundEventRecord } from '@baasconn/api/domain';
import { MemoryPollCursorRepository } from '@baasconn/api/testing';
import type { StatementEntry, StatementPage } from '@baasconn/provider-spi';
import {
  AccountStatus,
  ChangeSource,
  Environment,
  FixedClock,
  StatementEntryType,
} from '@baasconn/taxonomy';
import { beforeEach, describe, expect, it } from 'vitest';

import { PollService } from './poll.service.js';

const AGORA = new Date('2026-03-11T12:00:00.000Z');
const CONTA: AccountRecord = {
  id: 'acc_1',
  environment: Environment.HOMOLOGACAO,
  status: AccountStatus.ACTIVE,
  providerConnectionId: 'con_1',
  providerAccountId: 'mb-1',
} as AccountRecord;

function entrada(overrides: Partial<StatementEntry> = {}): StatementEntry {
  return {
    providerEntryId: 'MB-1',
    postedAt: '2026-03-11T10:00:00.000Z',
    effectiveDate: '2026-03-11',
    direction: 'credit',
    amount: { amount: '150000', currency: 'BRL', scale: 2 },
    type: StatementEntryType.PIX_IN,
    endToEndId: 'E1801234520260311100011111111',
    ...overrides,
  };
}

describe('poller de extrato', () => {
  let cursors: MemoryPollCursorRepository;
  let reivindicados: InboundEventRecord[];
  let aplicados: Array<{ source: string }>;
  let paginas: StatementPage[];
  let falharNoApply: boolean;
  let poll: PollService;

  beforeEach(() => {
    cursors = new MemoryPollCursorRepository();
    reivindicados = [];
    aplicados = [];
    falharNoApply = false;
    paginas = [{ data: [entrada()], hasMore: false }];

    let chamada = 0;
    poll = new PollService(
      {
        resolve: async () => ({
          slug: 'MOCK_BANK',
          context: { environment: Environment.HOMOLOGACAO },
          adapter: { statement: { list: async () => paginas[chamada++] ?? paginas.at(-1)! } },
        }),
      } as never,
      {
        applyDrafts: async (ctx: { source: string }) => {
          if (falharNoApply) throw new Error('apply falhou');
          aplicados.push({ source: ctx.source });
          return { outcomes: ['applied'], lockLost: false };
        },
      } as never,
      cursors,
      { findById: async () => CONTA } as never,
      {
        claim: async (record: InboundEventRecord) => {
          const ja = reivindicados.some((r) => r.dedupeKey === record.dedupeKey);
          if (!ja) reivindicados.push(record);
          return { inserted: !ja, record };
        },
      } as never,
      new FixedClock(AGORA),
    );
  });

  it('aplica o credito pelo mesmo caminho do webhook, com origem de conciliacao', async () => {
    const total = await poll.poll('con_1', 'acc_1');
    expect(total).toBe(1);
    expect(aplicados).toEqual([{ source: ChangeSource.RECONCILIATION }]);
  });

  it('a chave de dedup e namespaceada com `poll:`', async () => {
    // Sem namespace, a mesma entrada vista pelo webhook e pelo poller
    // colidiria na chave e a segunda sumiria em silencio.
    await poll.poll('con_1', 'acc_1');
    expect(reivindicados[0]?.dedupeKey).toBe('poll:MB-1');
  });

  it('a sobreposicao da janela e absorvida pelo indice unico, nao pelo guard', async () => {
    await poll.poll('con_1', 'acc_1');
    await poll.poll('con_1', 'acc_1');

    // A segunda volta reviu a mesma entrada e nao aplicou de novo: o custo
    // parou na reivindicacao, que e o ponto mais barato possivel.
    expect(reivindicados).toHaveLength(1);
    expect(aplicados).toHaveLength(1);
  });

  it('debito nunca e importado', async () => {
    // Importar um debito seria criar do nada uma transacao que tira dinheiro
    // do cliente.
    paginas = [{ data: [entrada({ direction: 'debit' })], hasMore: false }];
    expect(await poll.poll('con_1', 'acc_1')).toBe(0);
    expect(aplicados).toHaveLength(0);
  });

  it('a marca d agua avanca ate o fim da janela e converge para agora', async () => {
    // A primeira volta para `lapSeconds` antes de agora, porque o teto de 24 h
    // limita o salto e a sobreposicao recua o inicio. As voltas seguintes
    // alcancam — um cursor parado ha uma semana anda 24 h por volta em vez de
    // pedir a semana inteira e levar 500 do provedor para sempre.
    await poll.poll('con_1', 'acc_1');
    const primeira = [...cursors.rows.values()][0]!.watermark.getTime();
    expect(primeira).toBeLessThan(AGORA.getTime());

    paginas = [{ data: [], hasMore: false }];
    await poll.poll('con_1', 'acc_1');
    expect([...cursors.rows.values()][0]!.watermark.getTime()).toBe(AGORA.getTime());
  });

  it('erro no meio NAO avanca a marca d agua', async () => {
    // Avancar por cima de um erro e como um poller pula um dia em silencio:
    // nada falha, nada alerta, e o movimento daquele dia nunca chega.
    await poll.poll('con_1', 'acc_1');
    const antes = [...cursors.rows.values()][0]!.watermark.getTime();

    falharNoApply = true;
    paginas = [{ data: [entrada({ providerEntryId: 'MB-2' })], hasMore: false }];
    await expect(poll.poll('con_1', 'acc_1')).rejects.toThrow('apply falhou');

    expect([...cursors.rows.values()][0]!.watermark.getTime()).toBe(antes);
  });

  it('segue o cursor ate o fim do extrato', async () => {
    paginas = [
      { data: [entrada()], hasMore: true, nextCursor: 'c1' },
      { data: [entrada({ providerEntryId: 'MB-2' })], hasMore: false },
    ];
    expect(await poll.poll('con_1', 'acc_1')).toBe(2);
  });

  it('o cursor de polling nunca nasce com escopo vazio', async () => {
    // `@@unique([connectionId, stream, scopeId])` tem `scopeId` nullable, e em
    // Postgres NULL nao e igual a NULL num indice unico: dois cursores de
    // escopo nulo dariam duas marcas d'agua concorrentes para a mesma origem.
    await poll.poll('con_1', 'acc_1');
    expect([...cursors.rows.values()][0]?.scopeId).toBe('acc_1');
  });

  it('adapter sem extrato nao faz nada, e nao explode', async () => {
    poll = new PollService(
      {
        resolve: async () => ({
          slug: 'X',
          context: { environment: Environment.HOMOLOGACAO },
          adapter: {},
        }),
      } as never,
      { applyDrafts: async () => ({ outcomes: [], lockLost: false }) } as never,
      cursors,
      { findById: async () => CONTA } as never,
      { claim: async () => ({ inserted: true }) } as never,
      new FixedClock(AGORA),
    );
    expect(await poll.poll('con_1', 'acc_1')).toBe(0);
  });
});
