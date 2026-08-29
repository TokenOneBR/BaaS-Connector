import { assertInvariants, EntryPhase } from '@baasconn/ledger';
import { Environment, FixedClock, newId } from '@baasconn/taxonomy';
import { BaasError, BaasErrorCode } from '@baasconn/taxonomy';
import { beforeEach, describe, expect, it } from 'vitest';

import { MemoryLedgerStoreFactory } from './memory-ledger-store.js';
import { ShadowLedgerService } from './shadow-ledger.service.js';

const ENV = Environment.HOMOLOGACAO;

describe('ledger sombra', () => {
  let clock: FixedClock;
  let factory: MemoryLedgerStoreFactory;
  let ledger: ShadowLedgerService;
  let accountId: string;
  let accounts: { availableId: string; blockedId: string };

  beforeEach(async () => {
    clock = new FixedClock(new Date('2026-08-28T12:00:00.000Z'));
    factory = new MemoryLedgerStoreFactory(clock);
    ledger = new ShadowLedgerService(factory, clock);
    accountId = newId('account');
    accounts = await ledger.openAccounts(ENV, accountId);
  });

  const fund = (cents: bigint, key = `fund-${cents}`) =>
    ledger.creditIn({
      environment: ENV,
      availableId: accounts.availableId,
      amountCents: cents,
      idempotencyKey: key,
    });

  const invariants = () => {
    const { accounts: all, entries } = factory.for(ENV).snapshot();
    assertInvariants(all, entries);
  };

  it('abre o par de contas do cliente, e nao uma so', async () => {
    // Bloqueio e movimento real: precisa aparecer no extrato e ser auditavel,
    // o que um campo `blocked` na mesma conta nao da.
    expect(accounts.availableId).toBeTruthy();
    expect(accounts.blockedId).toBeTruthy();
    expect(accounts.availableId).not.toBe(accounts.blockedId);
  });

  it('reabrir devolve as mesmas contas', async () => {
    // A criacao de conta pode ser reexecutada por retry; abrir um segundo par
    // deixaria metade do saldo invisivel.
    const outra = await ledger.openAccounts(ENV, accountId);
    expect(outra).toEqual(accounts);
  });

  it('separa os razoes por ambiente', async () => {
    const producao = await ledger.openAccounts(Environment.PRODUCAO, accountId);
    // Um razao compartilhado com filtro por coluna esta a uma consulta
    // esquecida de misturar saldo de teste com saldo real.
    expect(producao.availableId).not.toBe(accounts.availableId);
  });

  it('credita PIX in do mundo externo', async () => {
    await fund(150_000n);
    const saldo = await ledger.balances(ENV, accounts.availableId);
    expect(saldo.posted).toBe(150_000n);
    expect(saldo.available).toBe(150_000n);
    invariants();
  });

  it('a mesma chave de idempotencia nao credita duas vezes', async () => {
    await fund(150_000n, 'mesma-chave');
    const segunda = await fund(150_000n, 'mesma-chave');

    expect(segunda.replayed).toBe(true);
    expect((await ledger.balances(ENV, accounts.availableId)).posted).toBe(150_000n);
  });

  it('autorizar reserva o valor sem move-lo', async () => {
    await fund(150_000n);
    await ledger.authorizeOut({
      environment: ENV,
      availableId: accounts.availableId,
      amountCents: 50_000n,
      idempotencyKey: 'auth-1',
    });

    const saldo = await ledger.balances(ENV, accounts.availableId);
    // O dinheiro ainda esta la (posted), mas nao esta mais disponivel.
    expect(saldo.posted).toBe(150_000n);
    expect(saldo.available).toBe(100_000n);
    invariants();
  });

  it('liquidar transforma a reserva em movimento', async () => {
    await fund(150_000n);
    const hold = await ledger.authorizeOut({
      environment: ENV,
      availableId: accounts.availableId,
      amountCents: 50_000n,
      idempotencyKey: 'auth-2',
    });

    await ledger.settleOut(ENV, hold.transaction.id, 'settle-2');

    const saldo = await ledger.balances(ENV, accounts.availableId);
    expect(saldo.posted).toBe(100_000n);
    expect(saldo.available).toBe(100_000n);
    invariants();
  });

  it('desfazer devolve o saldo e deixa rastro da tentativa', async () => {
    await fund(150_000n);
    const hold = await ledger.authorizeOut({
      environment: ENV,
      availableId: accounts.availableId,
      amountCents: 50_000n,
      idempotencyKey: 'auth-3',
    });

    await ledger.voidOut(ENV, hold.transaction.id, 'void-3');

    expect((await ledger.balances(ENV, accounts.availableId)).available).toBe(150_000n);

    // Os lancamentos VOID ficam: o extrato mostra que houve tentativa, sem que
    // ela tenha movido dinheiro.
    const { entries } = factory.for(ENV).snapshot();
    expect(entries.filter((entry) => entry.phase === EntryPhase.VOID)).toHaveLength(2);
    invariants();
  });

  it('recusa autorizacao acima do disponivel com os valores no corpo', async () => {
    await fund(10_000n);

    const erro = await ledger
      .authorizeOut({
        environment: ENV,
        availableId: accounts.availableId,
        amountCents: 15_000n,
        idempotencyKey: 'auth-4',
      })
      .catch((error: unknown) => error as BaasError);

    expect(erro).toBeInstanceOf(BaasError);
    expect((erro as BaasError).code).toBe(BaasErrorCode.INSUFFICIENT_FUNDS);
    // "Saldo insuficiente" sem dizer quanto ha obriga o cliente a uma segunda
    // chamada so para descobrir.
    expect((erro as BaasError).meta).toMatchObject({
      requested_cents: '15000',
      available_cents: '10000',
    });
  });

  it('uma reserva viva impede a proxima autorizacao', async () => {
    await fund(10_000n);
    await ledger.authorizeOut({
      environment: ENV,
      availableId: accounts.availableId,
      amountCents: 6_000n,
      idempotencyKey: 'auth-5',
    });

    // 10.000 postados, 6.000 reservados: os 5.000 seguintes nao cabem, mesmo
    // que o saldo "postado" pareca suficiente.
    await expect(
      ledger.authorizeOut({
        environment: ENV,
        availableId: accounts.availableId,
        amountCents: 5_000n,
        idempotencyKey: 'auth-6',
      }),
    ).rejects.toMatchObject({ code: BaasErrorCode.INSUFFICIENT_FUNDS });
  });

  it('bloqueio move entre as duas contas do cliente', async () => {
    await fund(10_000n);
    await ledger.moveBlocked({
      environment: ENV,
      availableId: accounts.availableId,
      blockedId: accounts.blockedId,
      amountCents: 4_000n,
      idempotencyKey: 'block-1',
    });

    expect((await ledger.balances(ENV, accounts.availableId)).available).toBe(6_000n);
    expect((await ledger.balances(ENV, accounts.blockedId)).posted).toBe(4_000n);
    invariants();
  });

  it('extrato inclui VOID e exclui PENDING', async () => {
    await fund(10_000n);
    const hold = await ledger.authorizeOut({
      environment: ENV,
      availableId: accounts.availableId,
      amountCents: 1_000n,
      idempotencyKey: 'auth-7',
    });
    await ledger.voidOut(ENV, hold.transaction.id, 'void-7');

    const emAberto = await ledger.authorizeOut({
      environment: ENV,
      availableId: accounts.availableId,
      amountCents: 2_000n,
      idempotencyKey: 'auth-8',
    });

    const lancamentos = await ledger.entries(
      ENV,
      accounts.availableId,
      new Date('2026-08-01T00:00:00.000Z'),
      new Date('2026-09-01T00:00:00.000Z'),
    );

    const fases = new Set(lancamentos.map((entry) => entry.phase));
    expect(fases.has(EntryPhase.VOID)).toBe(true);
    expect(fases.has(EntryPhase.PENDING)).toBe(false);
    expect(emAberto.transaction.id).toBeTruthy();
  });

  /**
   * O teste que define "correto" no conector.
   *
   * Se este passar, o razao sombra nao permite double-spend sob concorrencia.
   * Ele exercita a fase de AUTORIZACAO, que e onde a janela existe: entre ver
   * o saldo e reservar, duas transferencias podem enxergar o mesmo dinheiro.
   *
   * Roda contra o store em memoria. O que ele NAO prova e o lock de linha do
   * Postgres — isso e o `SELECT ... FOR UPDATE` da procedure, provado a parte
   * pelos testes PGlite, e so exercitado sob concorrencia real quando houver
   * Postgres na suite.
   */
  it('200 PIX-outs concorrentes com saldo para 100 reservam exatamente 100', async () => {
    const VALOR = 1_000n;
    const CONCORRENTES = 200;
    const CABEM = 100;

    await fund(VALOR * BigInt(CABEM), 'fund-concorrencia');

    const tentativas = Array.from({ length: CONCORRENTES }, (_, index) =>
      ledger
        .authorizeOut({
          environment: ENV,
          availableId: accounts.availableId,
          amountCents: VALOR,
          idempotencyKey: `concorrente-${index}`,
        })
        .then(() => 'reservado' as const)
        .catch((error: unknown) => {
          // Qualquer outro erro e relancado: um modo de falha errado precisa
          // reprovar o teste, nao contar como recusa.
          if (error instanceof BaasError && error.code === BaasErrorCode.INSUFFICIENT_FUNDS) {
            return 'recusado' as const;
          }
          throw error;
        }),
    );

    const desfechos = await Promise.all(tentativas);

    expect(desfechos.filter((d) => d === 'reservado')).toHaveLength(CABEM);
    expect(desfechos.filter((d) => d === 'recusado')).toHaveLength(CONCORRENTES - CABEM);
    expect((await ledger.balances(ENV, accounts.availableId)).available).toBe(0n);
    invariants();
  }, 30_000);
});
