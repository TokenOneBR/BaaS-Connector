import {
  EntryPhase,
  InMemoryLedgerStore,
  LedgerEngine,
  type LedgerAccount,
  type LedgerEntry,
  type LedgerTransaction,
  type PostTransactionResult,
} from '@baasconn/ledger';
import { systemClock, type Clock, type Environment } from '@baasconn/taxonomy';

import type { ConnectorLedgerStore, LedgerStoreFactory } from './ledger.types.js';

/**
 * Store em memoria do razao sombra.
 *
 * Mesma razao dos repositorios em memoria do dominio: a suite de ponta a ponta
 * exercita o caminho inteiro sem Postgres. O motor e o mesmo, entao o que este
 * store NAO prova e apenas o lock real do banco — a logica de partidas
 * dobradas e identica nos dois.
 */
export class MemoryConnectorLedgerStore implements ConnectorLedgerStore {
  private readonly inner = new InMemoryLedgerStore();
  readonly engine: LedgerEngine;

  constructor(clock: Clock = systemClock) {
    this.engine = new LedgerEngine({ store: this.inner, clock });
  }

  runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    return this.inner.runExclusive(fn);
  }

  lockAccounts(orderedIds: readonly string[]): Promise<Map<string, LedgerAccount>> {
    return this.inner.lockAccounts(orderedIds);
  }

  findByIdempotencyKey(key: string): Promise<PostTransactionResult | undefined> {
    return this.inner.findByIdempotencyKey(key);
  }

  findTransaction(id: string): Promise<LedgerTransaction | undefined> {
    return this.inner.findTransaction(id);
  }

  findEntriesByTransaction(id: string): Promise<LedgerEntry[]> {
    return this.inner.findEntriesByTransaction(id);
  }

  persist(
    transaction: LedgerTransaction,
    entries: readonly LedgerEntry[],
    accounts: readonly LedgerAccount[],
  ): Promise<void> {
    return this.inner.persist(transaction, entries, accounts);
  }

  async ensureAccounts(
    templates: readonly {
      code: string;
      name: string;
      type: string;
      ownerType: string;
      allowsNegative: boolean;
      ownerId?: string;
    }[],
    _newAccountId: () => string,
  ): Promise<Map<string, string>> {
    const byCode = new Map<string, string>();
    for (const template of templates) {
      // `createAccount` do store em memoria ja e idempotente por codigo.
      const account = this.inner.createAccount(template as never);
      byCode.set(account.code, account.id);
    }
    return byCode;
  }

  async accountIdByCode(code: string): Promise<string | undefined> {
    return this.inner.allAccounts().find((account) => account.code === code)?.id;
  }

  async entriesInWindow(ledgerAccountId: string, from: Date, to: Date): Promise<LedgerEntry[]> {
    return this.inner
      .allEntries()
      .filter(
        (entry) =>
          entry.accountId === ledgerAccountId &&
          // PENDING fora, VOID dentro: reserva em voo nao e movimento, mas
          // tentativa desfeita e fato que o operador precisa ver.
          entry.phase !== EntryPhase.PENDING &&
          entry.effectiveAt >= from &&
          entry.effectiveAt <= to,
      )
      .sort((a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime() || a.sequence - b.sequence);
  }

  /** Para as assercoes do teste: todas as contas e lancamentos. */
  snapshot(): { accounts: LedgerAccount[]; entries: LedgerEntry[] } {
    return { accounts: this.inner.allAccounts(), entries: this.inner.allEntries() };
  }
}

export class MemoryLedgerStoreFactory implements LedgerStoreFactory {
  private readonly byEnvironment = new Map<Environment, MemoryConnectorLedgerStore>();

  constructor(private readonly clock: Clock = systemClock) {}

  for(environment: Environment): MemoryConnectorLedgerStore {
    let store = this.byEnvironment.get(environment);
    if (!store) {
      store = new MemoryConnectorLedgerStore(this.clock);
      this.byEnvironment.set(environment, store);
    }
    return store;
  }
}
