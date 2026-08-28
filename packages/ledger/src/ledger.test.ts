import { FixedClock, Money } from '@baasconn/taxonomy';
import { describe, expect, it } from 'vitest';

import { computeBalances } from './balances.js';
import { customerAvailableCode, LEDGER_CODES } from './chart-of-accounts.js';
import { assertBalanced, LedgerEngine, lockOrder } from './engine.js';
import { InsufficientFundsError, LedgerUnbalancedError, LedgerValidationError } from './errors.js';
import { assertInvariants, checkInvariants } from './invariants.js';
import { InMemoryLedgerStore } from './memory-store.js';
import { EntryDirection, EntryPhase, LedgerTransactionType } from './types.js';

const CUSTOMER = 'acc_01JBQ8Z2K3M4N5P6Q7R8S9T0V1';

function setup() {
  const store = new InMemoryLedgerStore();
  const clock = new FixedClock(new Date('2026-08-28T12:00:00Z'));
  const engine = new LedgerEngine({ store, clock });
  const { available, blocked } = store.openCustomerAccounts(CUSTOMER);
  const external = store.byCode(LEDGER_CODES.EXTERNAL_WORLD);
  const clearing = store.byCode(LEDGER_CODES.PIX_OUT_CLEARING);
  const feeRevenue = store.byCode(LEDGER_CODES.FEE_REVENUE);
  return { store, clock, engine, available, blocked, external, clearing, feeRevenue };
}

/** Credita a subconta do cliente, como um PIX in faria. */
async function fund(
  ctx: ReturnType<typeof setup>,
  cents: bigint,
  key = `fund-${cents}`,
): Promise<void> {
  await ctx.store.runExclusive(() =>
    ctx.engine.post({
      type: LedgerTransactionType.PIX_IN_RECEIVE,
      phase: EntryPhase.POSTED,
      idempotencyKey: key,
      entries: [
        { accountId: ctx.external.id, direction: EntryDirection.DEBIT, amountCents: cents },
        { accountId: ctx.available.id, direction: EntryDirection.CREDIT, amountCents: cents },
      ],
    }),
  );
}

describe('assertBalanced', () => {
  it('exige ao menos dois lancamentos', () => {
    expect(() =>
      assertBalanced([{ accountId: 'a', direction: EntryDirection.DEBIT, amountCents: 100n }]),
    ).toThrow(LedgerValidationError);
  });

  it('recusa transacao desbalanceada', () => {
    expect(() =>
      assertBalanced([
        { accountId: 'a', direction: EntryDirection.DEBIT, amountCents: 100n },
        { accountId: 'b', direction: EntryDirection.CREDIT, amountCents: 99n },
      ]),
    ).toThrow(LedgerUnbalancedError);
  });

  it('recusa valor zero ou negativo: o sinal vive em direction', () => {
    expect(() =>
      assertBalanced([
        { accountId: 'a', direction: EntryDirection.DEBIT, amountCents: 0n },
        { accountId: 'b', direction: EntryDirection.CREDIT, amountCents: 0n },
      ]),
    ).toThrow(/nao positivo/);
  });

  it('aceita transacao com mais de dois lancamentos', () => {
    const result = assertBalanced([
      { accountId: 'a', direction: EntryDirection.DEBIT, amountCents: 100n },
      { accountId: 'b', direction: EntryDirection.CREDIT, amountCents: 70n },
      { accountId: 'c', direction: EntryDirection.CREDIT, amountCents: 30n },
    ]);
    expect(result).toEqual({ debits: 100n, credits: 100n });
  });
});

describe('lockOrder', () => {
  it('deduplica e ordena, que e o que elimina o deadlock A->B / B->A', () => {
    const order = lockOrder([
      { accountId: 'lac_z', direction: EntryDirection.DEBIT, amountCents: 1n },
      { accountId: 'lac_a', direction: EntryDirection.CREDIT, amountCents: 1n },
      { accountId: 'lac_z', direction: EntryDirection.CREDIT, amountCents: 1n },
    ]);
    expect(order).toEqual(['lac_a', 'lac_z']);
  });
});

describe('PIX in', () => {
  it('credita a subconta e o razao continua balanceado', async () => {
    const ctx = setup();
    await fund(ctx, 150_000n);

    const account = ctx.store.get(ctx.available.id)!;
    expect(computeBalances(account).posted).toBe(150_000n);
    assertInvariants(ctx.store.allAccounts(), ctx.store.allEntries());
  });

  it('e idempotente: repetir a chave nao credita de novo', async () => {
    const ctx = setup();
    await fund(ctx, 150_000n, 'mesma-chave');
    const second = await ctx.store.runExclusive(() =>
      ctx.engine.post({
        type: LedgerTransactionType.PIX_IN_RECEIVE,
        phase: EntryPhase.POSTED,
        idempotencyKey: 'mesma-chave',
        entries: [
          { accountId: ctx.external.id, direction: EntryDirection.DEBIT, amountCents: 150_000n },
          { accountId: ctx.available.id, direction: EntryDirection.CREDIT, amountCents: 150_000n },
        ],
      }),
    );

    expect(second.replayed).toBe(true);
    expect(computeBalances(ctx.store.get(ctx.available.id)!).posted).toBe(150_000n);
  });
});

describe('PIX out em duas fases', () => {
  it('reserva na autorizacao sem mexer no saldo postado', async () => {
    const ctx = setup();
    await fund(ctx, 150_000n);

    await ctx.store.runExclusive(() =>
      ctx.engine.post({
        type: LedgerTransactionType.PIX_OUT_AUTHORIZE,
        phase: EntryPhase.PENDING,
        idempotencyKey: 'pixout-1',
        entries: [
          { accountId: ctx.available.id, direction: EntryDirection.DEBIT, amountCents: 50_000n },
          { accountId: ctx.clearing.id, direction: EntryDirection.CREDIT, amountCents: 50_000n },
        ],
      }),
    );

    const balances = computeBalances(ctx.store.get(ctx.available.id)!);
    // O disponivel cai na hora, o postado so muda na liquidacao. E o que
    // impede double-spend na janela entre autorizacao e confirmacao do SPI.
    expect(balances.available).toBe(100_000n);
    expect(balances.posted).toBe(150_000n);
  });

  it('efetiva movendo o pendente para postado', async () => {
    const ctx = setup();
    await fund(ctx, 150_000n);
    const pending = await ctx.store.runExclusive(() =>
      ctx.engine.post({
        type: LedgerTransactionType.PIX_OUT_AUTHORIZE,
        phase: EntryPhase.PENDING,
        idempotencyKey: 'pixout-1',
        entries: [
          { accountId: ctx.available.id, direction: EntryDirection.DEBIT, amountCents: 50_000n },
          { accountId: ctx.clearing.id, direction: EntryDirection.CREDIT, amountCents: 50_000n },
        ],
      }),
    );

    await ctx.store.runExclusive(() =>
      ctx.engine.commitPending(pending.transaction.id, {
        idempotencyKey: 'pixout-1-settle',
        type: LedgerTransactionType.PIX_OUT_SETTLE,
      }),
    );

    const balances = computeBalances(ctx.store.get(ctx.available.id)!);
    expect(balances.posted).toBe(100_000n);
    expect(balances.available).toBe(100_000n);
    assertInvariants(ctx.store.allAccounts(), ctx.store.allEntries());
  });

  it('libera na falha e o disponivel volta, sem lancamento fantasma no extrato', async () => {
    const ctx = setup();
    await fund(ctx, 150_000n);
    const pending = await ctx.store.runExclusive(() =>
      ctx.engine.post({
        type: LedgerTransactionType.PIX_OUT_AUTHORIZE,
        phase: EntryPhase.PENDING,
        idempotencyKey: 'pixout-1',
        entries: [
          { accountId: ctx.available.id, direction: EntryDirection.DEBIT, amountCents: 50_000n },
          { accountId: ctx.clearing.id, direction: EntryDirection.CREDIT, amountCents: 50_000n },
        ],
      }),
    );

    await ctx.store.runExclusive(() =>
      ctx.engine.voidPending(pending.transaction.id, {
        idempotencyKey: 'pixout-1-void',
        type: LedgerTransactionType.PIX_OUT_VOID,
      }),
    );

    const balances = computeBalances(ctx.store.get(ctx.available.id)!);
    expect(balances.available).toBe(150_000n);
    expect(balances.posted).toBe(150_000n);
    // Os lancamentos da tentativa continuam la, com fase VOID: o extrato
    // mostra que houve tentativa, sem que ela tenha movido dinheiro.
    const voided = ctx.store.allEntries().filter((e) => e.phase === EntryPhase.VOID);
    expect(voided).toHaveLength(2);
  });

  it('recusa resolver uma transacao que ja foi resolvida', async () => {
    const ctx = setup();
    await fund(ctx, 150_000n);
    const pending = await ctx.store.runExclusive(() =>
      ctx.engine.post({
        type: LedgerTransactionType.PIX_OUT_AUTHORIZE,
        phase: EntryPhase.PENDING,
        idempotencyKey: 'pixout-1',
        entries: [
          { accountId: ctx.available.id, direction: EntryDirection.DEBIT, amountCents: 50_000n },
          { accountId: ctx.clearing.id, direction: EntryDirection.CREDIT, amountCents: 50_000n },
        ],
      }),
    );
    await ctx.store.runExclusive(() =>
      ctx.engine.commitPending(pending.transaction.id, { idempotencyKey: 'settle-1' }),
    );

    await expect(
      ctx.store.runExclusive(() =>
        ctx.engine.commitPending(pending.transaction.id, { idempotencyKey: 'settle-2' }),
      ),
    ).rejects.toThrow(/so PENDING pode ser resolvida/);
  });

  it('cobra tarifa no mesmo lancamento, sem caso especial', async () => {
    const ctx = setup();
    await fund(ctx, 150_000n);

    await ctx.store.runExclusive(() =>
      ctx.engine.post({
        type: LedgerTransactionType.PIX_OUT_AUTHORIZE,
        phase: EntryPhase.PENDING,
        idempotencyKey: 'pixout-com-tarifa',
        entries: [
          { accountId: ctx.available.id, direction: EntryDirection.DEBIT, amountCents: 50_150n },
          { accountId: ctx.clearing.id, direction: EntryDirection.CREDIT, amountCents: 50_000n },
          { accountId: ctx.feeRevenue.id, direction: EntryDirection.CREDIT, amountCents: 150n },
        ],
      }),
    );

    expect(computeBalances(ctx.store.get(ctx.available.id)!).available).toBe(99_850n);
    assertInvariants(ctx.store.allAccounts(), ctx.store.allEntries());
  });
});

describe('guarda de saldo negativo', () => {
  it('recusa debito acima do disponivel', async () => {
    const ctx = setup();
    await fund(ctx, 10_000n);

    await expect(
      ctx.store.runExclusive(() =>
        ctx.engine.post({
          type: LedgerTransactionType.PIX_OUT_AUTHORIZE,
          phase: EntryPhase.PENDING,
          idempotencyKey: 'demais',
          entries: [
            { accountId: ctx.available.id, direction: EntryDirection.DEBIT, amountCents: 10_001n },
            { accountId: ctx.clearing.id, direction: EntryDirection.CREDIT, amountCents: 10_001n },
          ],
        }),
      ),
    ).rejects.toThrow(InsufficientFundsError);
  });

  it('conta recusada nao registra nenhum lancamento', async () => {
    const ctx = setup();
    await fund(ctx, 10_000n);
    const before = ctx.store.allEntries().length;

    await expect(
      ctx.store.runExclusive(() =>
        ctx.engine.post({
          type: LedgerTransactionType.PIX_OUT_AUTHORIZE,
          phase: EntryPhase.PENDING,
          idempotencyKey: 'demais',
          entries: [
            { accountId: ctx.available.id, direction: EntryDirection.DEBIT, amountCents: 99_999n },
            { accountId: ctx.clearing.id, direction: EntryDirection.CREDIT, amountCents: 99_999n },
          ],
        }),
      ),
    ).rejects.toThrow(InsufficientFundsError);

    expect(ctx.store.allEntries()).toHaveLength(before);
    expect(computeBalances(ctx.store.get(ctx.available.id)!).posted).toBe(10_000n);
  });

  it('a reserva pendente conta contra o disponivel', async () => {
    const ctx = setup();
    await fund(ctx, 10_000n);
    await ctx.store.runExclusive(() =>
      ctx.engine.post({
        type: LedgerTransactionType.PIX_OUT_AUTHORIZE,
        phase: EntryPhase.PENDING,
        idempotencyKey: 'reserva',
        entries: [
          { accountId: ctx.available.id, direction: EntryDirection.DEBIT, amountCents: 6_000n },
          { accountId: ctx.clearing.id, direction: EntryDirection.CREDIT, amountCents: 6_000n },
        ],
      }),
    );

    // Sobram 4.000: 5.000 precisa ser recusado mesmo com 10.000 postados.
    await expect(
      ctx.store.runExclusive(() =>
        ctx.engine.post({
          type: LedgerTransactionType.PIX_OUT_AUTHORIZE,
          phase: EntryPhase.PENDING,
          idempotencyKey: 'segunda-reserva',
          entries: [
            { accountId: ctx.available.id, direction: EntryDirection.DEBIT, amountCents: 5_000n },
            { accountId: ctx.clearing.id, direction: EntryDirection.CREDIT, amountCents: 5_000n },
          ],
        }),
      ),
    ).rejects.toThrow(InsufficientFundsError);
  });

  it('permite negativo apenas em conta marcada, como a contraparte externa', async () => {
    const ctx = setup();
    // Um PIX in debita o mundo externo, que fica negativo por construcao.
    await fund(ctx, 150_000n);
    expect(computeBalances(ctx.store.get(ctx.external.id)!).posted).toBe(150_000n);
    expect(checkInvariants(ctx.store.allAccounts(), ctx.store.allEntries())).toEqual([]);
  });
});

/**
 * O teste que define "correto" neste projeto.
 *
 * Se este passar, o motor nao permite double-spend sob concorrencia. Se
 * falhar, nada mais no repositorio importa.
 */
describe('concorrencia: 200 PIX-outs disputando saldo para 100', () => {
  const AMOUNT = 1_000n;
  const CONCURRENT = 200;
  const AFFORDABLE = 100;

  it('liquida exatamente 100 e recusa exatamente 100', async () => {
    const ctx = setup();
    await fund(ctx, AMOUNT * BigInt(AFFORDABLE));

    const attempts = Array.from({ length: CONCURRENT }, (_, i) =>
      ctx.store
        .runExclusive(() =>
          ctx.engine.post({
            type: LedgerTransactionType.PIX_OUT_AUTHORIZE,
            phase: EntryPhase.PENDING,
            idempotencyKey: `concorrente-${i}`,
            entries: [
              { accountId: ctx.available.id, direction: EntryDirection.DEBIT, amountCents: AMOUNT },
              { accountId: ctx.clearing.id, direction: EntryDirection.CREDIT, amountCents: AMOUNT },
            ],
          }),
        )
        .then(
          () => 'settled' as const,
          (error: unknown) => {
            if (error instanceof InsufficientFundsError) return 'rejected' as const;
            throw error;
          },
        ),
    );

    const outcomes = await Promise.all(attempts);
    const settled = outcomes.filter((o) => o === 'settled').length;
    const rejected = outcomes.filter((o) => o === 'rejected').length;

    expect(settled).toBe(AFFORDABLE);
    expect(rejected).toBe(CONCURRENT - AFFORDABLE);

    const balances = computeBalances(ctx.store.get(ctx.available.id)!);
    expect(balances.available).toBe(0n);
    expect(balances.available).toBeGreaterThanOrEqual(0n);

    assertInvariants(ctx.store.allAccounts(), ctx.store.allEntries());
  });

  it('nao ha deadlock quando duas contas sao travadas em ordens opostas', async () => {
    const ctx = setup();
    const other = ctx.store.openCustomerAccounts('acc_01JBQ8Z2K3M4N5P6Q7R8S9T0V2');
    await fund(ctx, 100_000n);
    await ctx.store.runExclusive(() =>
      ctx.engine.post({
        type: LedgerTransactionType.PIX_IN_RECEIVE,
        phase: EntryPhase.POSTED,
        idempotencyKey: 'fund-other',
        entries: [
          { accountId: ctx.external.id, direction: EntryDirection.DEBIT, amountCents: 100_000n },
          {
            accountId: other.available.id,
            direction: EntryDirection.CREDIT,
            amountCents: 100_000n,
          },
        ],
      }),
    );

    // A->B e B->A ao mesmo tempo: lockOrder ordena os dois igual, entao nao
    // ha ciclo de espera.
    const transfers = [
      ctx.store.runExclusive(() =>
        ctx.engine.post({
          type: LedgerTransactionType.MANUAL_ADJUSTMENT,
          phase: EntryPhase.POSTED,
          idempotencyKey: 'a-para-b',
          entries: [
            { accountId: ctx.available.id, direction: EntryDirection.DEBIT, amountCents: 10_000n },
            {
              accountId: other.available.id,
              direction: EntryDirection.CREDIT,
              amountCents: 10_000n,
            },
          ],
        }),
      ),
      ctx.store.runExclusive(() =>
        ctx.engine.post({
          type: LedgerTransactionType.MANUAL_ADJUSTMENT,
          phase: EntryPhase.POSTED,
          idempotencyKey: 'b-para-a',
          entries: [
            { accountId: other.available.id, direction: EntryDirection.DEBIT, amountCents: 5_000n },
            { accountId: ctx.available.id, direction: EntryDirection.CREDIT, amountCents: 5_000n },
          ],
        }),
      ),
    ];

    await expect(Promise.all(transfers)).resolves.toHaveLength(2);
    assertInvariants(ctx.store.allAccounts(), ctx.store.allEntries());
  });
});

describe('invariantes', () => {
  it('detecta contador materializado divergente dos lancamentos', () => {
    const ctx = setup();
    const account = { ...ctx.store.get(ctx.available.id)!, creditsPosted: 999n };
    const violations = checkInvariants([account], []);
    expect(violations.some((v) => v.invariant === 'posted_counters_match_entries')).toBe(true);
  });

  it('detecta transacao desbalanceada nos lancamentos persistidos', () => {
    const violations = checkInvariants(
      [],
      [
        {
          id: 'len_1',
          transactionId: 'ltx_1',
          accountId: 'lac_a',
          direction: EntryDirection.DEBIT,
          amountCents: 100n,
          phase: EntryPhase.POSTED,
          currency: 'BRL',
          sequence: 0,
          resultingPostedCents: 100n,
          effectiveAt: new Date(),
        },
      ],
    );
    expect(violations.some((v) => v.invariant === 'transaction_balanced')).toBe(true);
    expect(violations.some((v) => v.invariant === 'ledger_balanced')).toBe(true);
  });
});

describe('integracao com Money', () => {
  it('o codigo da conta de cliente carrega o id da subconta', () => {
    expect(customerAvailableCode(CUSTOMER)).toBe(`2000.${CUSTOMER}`);
  });

  it('centavos do razao convertem para Money sem perda', async () => {
    const ctx = setup();
    await fund(ctx, 150_075n);
    const posted = computeBalances(ctx.store.get(ctx.available.id)!).posted;
    expect(Money.of(posted).toDecimalString()).toBe('1500.75');
  });
});
