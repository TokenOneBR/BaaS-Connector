import { newId } from '@baasconn/taxonomy';

import {
  customerAccountTemplates,
  normalBalanceFor,
  SINGLETON_ACCOUNTS,
} from './chart-of-accounts.js';
import type { LedgerStore } from './engine.js';
import {
  LedgerAccountStatus,
  type LedgerAccount,
  type LedgerEntry,
  type LedgerTransaction,
  type PostTransactionResult,
} from './types.js';

/**
 * Store em memoria.
 *
 * Usado pelos testes e pelo modo `MOCK_BANK_STORE=memory`. Serializa toda
 * operacao numa fila, o que e o analogo em processo do `SELECT ... FOR UPDATE`
 * da implementacao Postgres: sem isso, o teste de concorrencia passaria por
 * acidente e nao provaria nada sobre o motor.
 */
export class InMemoryLedgerStore implements LedgerStore {
  private readonly accounts = new Map<string, LedgerAccount>();
  private readonly accountsByCode = new Map<string, string>();
  private readonly transactions = new Map<string, LedgerTransaction>();
  private readonly entries = new Map<string, LedgerEntry[]>();
  private readonly byIdempotencyKey = new Map<string, string>();

  /** Fila que serializa as operacoes, emulando o lock de linha do Postgres. */
  private tail: Promise<unknown> = Promise.resolve();

  constructor() {
    for (const template of SINGLETON_ACCOUNTS) this.createAccount(template);
  }

  /** Executa `fn` com exclusividade sobre o razao inteiro. */
  runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    // A cauda ignora rejeicoes para uma operacao que falhou nao travar a fila.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  createAccount(template: {
    code: string;
    name: string;
    type: LedgerAccount['type'];
    ownerType: LedgerAccount['ownerType'];
    allowsNegative: boolean;
    ownerId?: string;
  }): LedgerAccount {
    const existingId = this.accountsByCode.get(template.code);
    if (existingId) return this.accounts.get(existingId)!;

    const account: LedgerAccount = {
      id: newId('ledgerAccount'),
      code: template.code,
      name: template.name,
      type: template.type,
      normalBalance: normalBalanceFor(template.type),
      currency: 'BRL',
      ownerType: template.ownerType,
      ownerId: template.ownerId,
      status: LedgerAccountStatus.OPEN,
      allowsNegative: template.allowsNegative,
      debitsPosted: 0n,
      creditsPosted: 0n,
      debitsPending: 0n,
      creditsPending: 0n,
      entryCount: 0n,
      version: 0n,
    };
    this.accounts.set(account.id, account);
    this.accountsByCode.set(account.code, account.id);
    return account;
  }

  /** Cria o par de contas (disponivel e bloqueada) de uma subconta. */
  openCustomerAccounts(customerAccountId: string): {
    available: LedgerAccount;
    blocked: LedgerAccount;
  } {
    const [availableTemplate, blockedTemplate] = customerAccountTemplates(customerAccountId);
    return {
      available: this.createAccount({ ...availableTemplate!, ownerId: customerAccountId }),
      blocked: this.createAccount({ ...blockedTemplate!, ownerId: customerAccountId }),
    };
  }

  byCode(code: string): LedgerAccount {
    const id = this.accountsByCode.get(code);
    if (!id) throw new Error(`Conta de razao com codigo ${code} nao existe`);
    return this.accounts.get(id)!;
  }

  get(id: string): LedgerAccount | undefined {
    return this.accounts.get(id);
  }

  allAccounts(): LedgerAccount[] {
    return [...this.accounts.values()];
  }

  allEntries(): LedgerEntry[] {
    return [...this.entries.values()].flat();
  }

  async lockAccounts(orderedIds: readonly string[]): Promise<Map<string, LedgerAccount>> {
    const locked = new Map<string, LedgerAccount>();
    for (const id of orderedIds) {
      const account = this.accounts.get(id);
      // Copia defensiva: o motor muta o que recebe, e um erro no meio nao
      // pode deixar contadores parcialmente aplicados no store.
      if (account) locked.set(id, { ...account });
    }
    return locked;
  }

  async findByIdempotencyKey(key: string): Promise<PostTransactionResult | undefined> {
    const transactionId = this.byIdempotencyKey.get(key);
    if (!transactionId) return undefined;
    return {
      transaction: this.transactions.get(transactionId)!,
      entries: this.entries.get(transactionId) ?? [],
      replayed: true,
    };
  }

  async findTransaction(id: string): Promise<LedgerTransaction | undefined> {
    return this.transactions.get(id);
  }

  async findEntriesByTransaction(id: string): Promise<LedgerEntry[]> {
    return this.entries.get(id) ?? [];
  }

  async persist(
    transaction: LedgerTransaction,
    entries: readonly LedgerEntry[],
    accounts: readonly LedgerAccount[],
  ): Promise<void> {
    this.transactions.set(transaction.id, transaction);
    if (entries.length > 0) {
      this.entries.set(transaction.id, [...entries]);
      this.byIdempotencyKey.set(transaction.idempotencyKey, transaction.id);
    }
    for (const account of accounts) this.accounts.set(account.id, { ...account });
  }
}
