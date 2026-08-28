import { newId, type Clock, type CurrencyCode } from '@baasconn/taxonomy';

import { computeBalances, violatesOverdraftGuard } from './balances.js';
import { InsufficientFundsError, LedgerUnbalancedError, LedgerValidationError } from './errors.js';
import {
  EntryDirection,
  EntryPhase,
  LedgerTransactionStatus,
  type LedgerAccount,
  type LedgerEntry,
  type LedgerEntryInput,
  type LedgerTransaction,
  type PostTransactionInput,
  type PostTransactionResult,
} from './types.js';

/**
 * Armazenamento do razao.
 *
 * A implementacao Postgres roda tudo dentro de uma stored procedure com
 * `SELECT ... FOR UPDATE` em ordem deterministica. A implementacao em memoria
 * (para testes e para o modo `memory` do Mock Bank) usa o mesmo motor com um
 * mutex por transacao.
 */
export interface LedgerStore {
  /**
   * Carrega e trava as contas na ordem em que os ids sao dados.
   *
   * A ORDEM IMPORTA e o chamador ja a ordenou: e o que elimina o deadlock
   * classico A->B / B->A. A implementacao Postgres traduz isto para
   * `SELECT ... WHERE id = ANY($1) ORDER BY id FOR UPDATE`.
   */
  lockAccounts(orderedIds: readonly string[]): Promise<Map<string, LedgerAccount>>;
  findByIdempotencyKey(key: string): Promise<PostTransactionResult | undefined>;
  findTransaction(id: string): Promise<LedgerTransaction | undefined>;
  findEntriesByTransaction(id: string): Promise<LedgerEntry[]>;
  persist(
    transaction: LedgerTransaction,
    entries: readonly LedgerEntry[],
    accounts: readonly LedgerAccount[],
  ): Promise<void>;
}

export interface LedgerEngineOptions {
  store: LedgerStore;
  clock: Clock;
  currency?: CurrencyCode;
}

interface CounterDelta {
  debitsPosted: bigint;
  creditsPosted: bigint;
  debitsPending: bigint;
  creditsPending: bigint;
}

const ZERO_DELTA: CounterDelta = {
  debitsPosted: 0n,
  creditsPosted: 0n,
  debitsPending: 0n,
  creditsPending: 0n,
};

/**
 * Valida a invariante central: a soma dos lancamentos de uma transacao e zero.
 *
 * Roda ANTES de qualquer lock, para falhar rapido sem segurar contenda.
 */
export function assertBalanced(entries: readonly LedgerEntryInput[]): {
  debits: bigint;
  credits: bigint;
} {
  if (entries.length < 2) {
    throw new LedgerValidationError(
      'Uma transacao de partidas dobradas exige ao menos 2 lancamentos',
    );
  }

  let debits = 0n;
  let credits = 0n;
  for (const entry of entries) {
    if (entry.amountCents <= 0n) {
      throw new LedgerValidationError(
        `Lancamento com valor nao positivo (${entry.amountCents}); o sinal vive em direction`,
      );
    }
    if (entry.direction === EntryDirection.DEBIT) debits += entry.amountCents;
    else credits += entry.amountCents;
  }

  if (debits !== credits) throw new LedgerUnbalancedError(debits, credits);
  return { debits, credits };
}

/** Ids unicos das contas afetadas, ordenados: a ordem previne deadlock. */
export function lockOrder(entries: readonly LedgerEntryInput[]): string[] {
  return [...new Set(entries.map((e) => e.accountId))].sort();
}

function applyDelta(account: LedgerAccount, delta: CounterDelta): LedgerAccount {
  return {
    ...account,
    debitsPosted: account.debitsPosted + delta.debitsPosted,
    creditsPosted: account.creditsPosted + delta.creditsPosted,
    debitsPending: account.debitsPending + delta.debitsPending,
    creditsPending: account.creditsPending + delta.creditsPending,
    entryCount: account.entryCount + 1n,
    version: account.version + 1n,
  };
}

function deltaFor(entry: LedgerEntryInput, phase: EntryPhase): CounterDelta {
  const isDebit = entry.direction === EntryDirection.DEBIT;
  if (phase === EntryPhase.PENDING) {
    return isDebit
      ? { ...ZERO_DELTA, debitsPending: entry.amountCents }
      : { ...ZERO_DELTA, creditsPending: entry.amountCents };
  }
  return isDebit
    ? { ...ZERO_DELTA, debitsPosted: entry.amountCents }
    : { ...ZERO_DELTA, creditsPosted: entry.amountCents };
}

/** Ao efetivar, o pendente sai e o postado entra, na mesma operacao. */
function resolveDelta(entry: LedgerEntryInput, commit: boolean): CounterDelta {
  const isDebit = entry.direction === EntryDirection.DEBIT;
  const release = isDebit
    ? { ...ZERO_DELTA, debitsPending: -entry.amountCents }
    : { ...ZERO_DELTA, creditsPending: -entry.amountCents };

  if (!commit) return release;

  return isDebit
    ? { ...release, debitsPosted: entry.amountCents }
    : { ...release, creditsPosted: entry.amountCents };
}

export class LedgerEngine {
  private readonly store: LedgerStore;
  private readonly clock: Clock;
  private readonly currency: CurrencyCode;

  constructor(options: LedgerEngineOptions) {
    this.store = options.store;
    this.clock = options.clock;
    this.currency = options.currency ?? 'BRL';
  }

  /**
   * Registra uma transacao balanceada, em fase pendente ou ja efetivada.
   *
   * Idempotente por `idempotencyKey`: repetir a chamada devolve o resultado
   * original com `replayed: true`, sem lancar nada novo.
   */
  async post(input: PostTransactionInput): Promise<PostTransactionResult> {
    const existing = await this.store.findByIdempotencyKey(input.idempotencyKey);
    if (existing) return { ...existing, replayed: true };

    const { debits } = assertBalanced(input.entries);
    const currency = input.currency ?? this.currency;
    const effectiveAt = input.effectiveAt ?? this.clock.now();

    const accounts = await this.store.lockAccounts(lockOrder(input.entries));
    this.assertAccountsExist(input.entries, accounts);

    const transaction: LedgerTransaction = {
      id: input.id ?? newId('ledgerTransaction'),
      type: input.type,
      status:
        input.phase === EntryPhase.PENDING
          ? LedgerTransactionStatus.PENDING
          : LedgerTransactionStatus.POSTED,
      currency,
      amountCents: debits,
      idempotencyKey: input.idempotencyKey,
      externalRef: input.externalRef,
      description: input.description,
      effectiveAt,
      postedAt: input.phase === EntryPhase.POSTED ? effectiveAt : undefined,
      metadata: input.metadata ?? {},
    };

    const entries = this.buildEntries(input.entries, transaction, input.phase, accounts, (entry) =>
      deltaFor(entry, input.phase),
    );

    await this.store.persist(transaction, entries, [...accounts.values()]);
    return { transaction, entries, replayed: false };
  }

  /**
   * Efetiva uma transacao pendente: o reservado vira postado.
   *
   * Cria uma transacao NOVA que referencia a pendente, em vez de mutar a
   * original. Lancamento e imutavel; correcao e sempre lancamento novo.
   */
  async commitPending(
    pendingTransactionId: string,
    options: { idempotencyKey: string; type?: PostTransactionInput['type'] },
  ): Promise<PostTransactionResult> {
    return this.resolvePending(pendingTransactionId, options, true);
  }

  /** Libera uma transacao pendente sem efetivar. O reservado volta. */
  async voidPending(
    pendingTransactionId: string,
    options: { idempotencyKey: string; type?: PostTransactionInput['type'] },
  ): Promise<PostTransactionResult> {
    return this.resolvePending(pendingTransactionId, options, false);
  }

  private async resolvePending(
    pendingTransactionId: string,
    options: { idempotencyKey: string; type?: PostTransactionInput['type'] },
    commit: boolean,
  ): Promise<PostTransactionResult> {
    const existing = await this.store.findByIdempotencyKey(options.idempotencyKey);
    if (existing) return { ...existing, replayed: true };

    const pending = await this.store.findTransaction(pendingTransactionId);
    if (!pending) {
      throw new LedgerValidationError(`Transacao pendente ${pendingTransactionId} nao encontrada`);
    }
    if (pending.status !== LedgerTransactionStatus.PENDING) {
      throw new LedgerValidationError(
        `Transacao ${pendingTransactionId} esta ${pending.status}; so PENDING pode ser resolvida`,
      );
    }

    const pendingEntries = await this.store.findEntriesByTransaction(pendingTransactionId);
    const inputs: LedgerEntryInput[] = pendingEntries.map((e) => ({
      accountId: e.accountId,
      direction: e.direction,
      amountCents: e.amountCents,
    }));

    const now = this.clock.now();
    const accounts = await this.store.lockAccounts(lockOrder(inputs));

    const transaction: LedgerTransaction = {
      id: newId('ledgerTransaction'),
      type: options.type ?? pending.type,
      status: commit ? LedgerTransactionStatus.POSTED : LedgerTransactionStatus.VOIDED,
      currency: pending.currency,
      amountCents: pending.amountCents,
      idempotencyKey: options.idempotencyKey,
      externalRef: pending.externalRef,
      description: pending.description,
      pendingTransactionId,
      effectiveAt: now,
      postedAt: commit ? now : undefined,
      voidedAt: commit ? undefined : now,
      metadata: pending.metadata,
    };

    const entries = this.buildEntries(
      inputs,
      transaction,
      commit ? EntryPhase.POSTED : EntryPhase.VOID,
      accounts,
      (entry) => resolveDelta(entry, commit),
    );

    const resolvedPending: LedgerTransaction = {
      ...pending,
      status: commit ? LedgerTransactionStatus.POSTED : LedgerTransactionStatus.VOIDED,
      postedAt: commit ? now : pending.postedAt,
      voidedAt: commit ? pending.voidedAt : now,
    };

    await this.store.persist(transaction, entries, [...accounts.values()]);
    await this.store.persist(resolvedPending, [], []);

    return { transaction, entries, replayed: false };
  }

  private assertAccountsExist(
    entries: readonly LedgerEntryInput[],
    accounts: Map<string, LedgerAccount>,
  ): void {
    for (const entry of entries) {
      if (!accounts.has(entry.accountId)) {
        throw new LedgerValidationError(`Conta de razao ${entry.accountId} nao existe`);
      }
    }
  }

  /**
   * Aplica os deltas e materializa os lancamentos.
   *
   * A guarda de saldo negativo roda aqui, com a conta ja travada. No Postgres
   * a mesma invariante e um CHECK constraint, que e o que de fato garante a
   * propriedade: esta checagem existe para dar mensagem util e para o motor
   * em memoria.
   */
  private buildEntries(
    inputs: readonly LedgerEntryInput[],
    transaction: LedgerTransaction,
    phase: EntryPhase,
    accounts: Map<string, LedgerAccount>,
    delta: (entry: LedgerEntryInput) => CounterDelta,
  ): LedgerEntry[] {
    const entries: LedgerEntry[] = [];

    inputs.forEach((input, index) => {
      const before = accounts.get(input.accountId);
      if (!before) throw new LedgerValidationError(`Conta ${input.accountId} nao travada`);

      const after = applyDelta(before, delta(input));
      if (violatesOverdraftGuard(after)) {
        throw new InsufficientFundsError(
          input.accountId,
          input.amountCents,
          computeBalances(before).available,
        );
      }
      accounts.set(input.accountId, after);

      entries.push({
        id: newId('ledgerEntry'),
        transactionId: transaction.id,
        accountId: input.accountId,
        direction: input.direction,
        amountCents: input.amountCents,
        phase,
        currency: transaction.currency,
        sequence: index,
        resultingPostedCents: computeBalances(after).posted,
        effectiveAt: transaction.effectiveAt,
      });
    });

    return entries;
  }
}
