import { PrismaLedgerStore } from '@baasconn/db';
// De `@baasconn/ledger`, e nao de `@baasconn/db`: o pacote db reexporta o
// `@prisma/client` inteiro, entao `LedgerEntry` la e o MODELO DA TABELA, com
// `ledgerAccountId` e `environment`. O DTO do motor tem `accountId` e nao tem
// ambiente. Trocar os dois compila em varios pontos e quebra no mapeamento.
import { EntryPhase, LedgerEngine, type LedgerEntry } from '@baasconn/ledger';
import { systemClock, type Clock, type Environment } from '@baasconn/taxonomy';

import type { PrismaService } from '../persistence/prisma.service.js';

import type { ConnectorLedgerStore, LedgerStoreFactory } from './ledger.types.js';

/**
 * Store Postgres do razao sombra.
 *
 * `runExclusive` e uma transacao interativa do Prisma: o lock de linha do
 * `SELECT ... FOR UPDATE` que o `lockAccounts` emite so vale ate o COMMIT,
 * entao TODO o trabalho do motor — ler contadores, decidir, escrever —
 * precisa acontecer dentro dela. Chamar o motor fora da transacao tornaria o
 * lock decorativo.
 */
export class PrismaConnectorLedgerStore implements ConnectorLedgerStore {
  readonly engine: LedgerEngine;
  private readonly base: PrismaLedgerStore;
  /** Store ligado a transacao em curso, quando ha uma. */
  private scoped?: PrismaLedgerStore;

  constructor(
    private readonly prisma: PrismaService,
    private readonly environment: Environment,
    private readonly clock: Clock = systemClock,
  ) {
    this.base = new PrismaLedgerStore(this.prisma.client, environment);
    this.engine = new LedgerEngine({ store: this, clock: this.clock });
  }

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    return this.prisma.client.$transaction(async (tx) => {
      this.scoped = new PrismaLedgerStore(tx as never, this.environment);
      try {
        return await fn();
      } finally {
        this.scoped = undefined;
      }
    });
  }

  private get active(): PrismaLedgerStore {
    return this.scoped ?? this.base;
  }

  lockAccounts(orderedIds: readonly string[]) {
    return this.active.lockAccounts(orderedIds);
  }

  findByIdempotencyKey(key: string) {
    return this.active.findByIdempotencyKey(key);
  }

  findTransaction(id: string) {
    return this.active.findTransaction(id);
  }

  findEntriesByTransaction(id: string) {
    return this.active.findEntriesByTransaction(id);
  }

  persist(...args: Parameters<PrismaLedgerStore['persist']>) {
    return this.active.persist(...args);
  }

  ensureAccounts(...args: Parameters<PrismaLedgerStore['ensureAccounts']>) {
    return this.active.ensureAccounts(...args);
  }

  accountIdByCode(code: string) {
    return this.active.accountIdByCode(code);
  }

  async entriesInWindow(ledgerAccountId: string, from: Date, to: Date): Promise<LedgerEntry[]> {
    const rows = await this.prisma.client.ledgerEntry.findMany({
      where: {
        environment: this.environment,
        ledgerAccountId,
        // PENDING fora, VOID dentro: reserva em voo nao e movimento, mas
        // tentativa desfeita e fato que o operador precisa ver.
        phase: { not: EntryPhase.PENDING },
        effectiveAt: { gte: from, lte: to },
      },
      orderBy: [{ effectiveAt: 'asc' }, { sequence: 'asc' }],
    });

    return rows.map((row) => ({
      id: row.id,
      transactionId: row.transactionId,
      accountId: row.ledgerAccountId,
      direction: row.direction as LedgerEntry['direction'],
      amountCents: row.amountCents,
      phase: row.phase as EntryPhase,
      currency: row.currency as LedgerEntry['currency'],
      sequence: row.sequence,
      resultingPostedCents: row.resultingPostedCents,
      effectiveAt: row.effectiveAt,
    }));
  }
}

export class PrismaLedgerStoreFactory implements LedgerStoreFactory {
  private readonly byEnvironment = new Map<Environment, PrismaConnectorLedgerStore>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock = systemClock,
  ) {}

  for(environment: Environment): PrismaConnectorLedgerStore {
    let store = this.byEnvironment.get(environment);
    if (!store) {
      store = new PrismaConnectorLedgerStore(this.prisma, environment, this.clock);
      this.byEnvironment.set(environment, store);
    }
    return store;
  }
}
