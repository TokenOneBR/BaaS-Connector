import {
  assertInvariants,
  computeBalances,
  customerAvailableCode,
  customerBlockedCode,
  EntryDirection,
  EntryPhase,
  InMemoryLedgerStore,
  InsufficientFundsError,
  LedgerEngine,
  LedgerTransactionType,
  LEDGER_CODES,
  Balances,
  LedgerEntryInput,
  PostTransactionResult,
} from '@baasconn/ledger';
import { Injectable, OnModuleInit } from '@nestjs/common';

import { MockClock } from '../common/clock.provider.js';
import { MockBankError } from '../common/errors.js';

/**
 * Ledger autoritativo do Mock Bank.
 *
 * Toda movimentacao passa por aqui, inclusive as simuladas: e o que faz o
 * Mock Bank ser um banco falso util em vez de um gerador de JSON. Se o saldo
 * que ele devolve nao vier de partidas dobradas, ele nao exercita a
 * conciliacao do conector.
 */
@Injectable()
export class LedgerService implements OnModuleInit {
  private readonly store = new InMemoryLedgerStore();
  private readonly engine: LedgerEngine;

  constructor(private readonly clock: MockClock) {
    this.engine = new LedgerEngine({ store: this.store, clock });
  }

  onModuleInit(): void {
    // As contas singleton ja sao criadas pelo construtor do store.
  }

  openCustomerAccounts(accountId: string): { availableId: string; blockedId: string } {
    const { available, blocked } = this.store.openCustomerAccounts(accountId);
    return { availableId: available.id, blockedId: blocked.id };
  }

  balances(ledgerAccountId: string): Balances {
    const account = this.store.get(ledgerAccountId);
    if (!account) throw MockBankError.accountNotFound(ledgerAccountId);
    return computeBalances(account);
  }

  private byCode(code: string): string {
    return this.store.byCode(code).id;
  }

  /**
   * Credita a subconta: PIX in.
   *
   * Debita o mundo externo, que e a contraparte de tudo que entra ou sai do
   * banco. Ter essa conta explicita mantem toda transacao balanceada sem caso
   * especial.
   */
  async creditFromExternal(options: {
    ledgerAccountId: string;
    amountCents: bigint;
    idempotencyKey: string;
    externalRef?: string;
    description?: string;
  }): Promise<PostTransactionResult> {
    return this.run(() =>
      this.engine.post({
        type: LedgerTransactionType.PIX_IN_RECEIVE,
        phase: EntryPhase.POSTED,
        idempotencyKey: options.idempotencyKey,
        externalRef: options.externalRef,
        description: options.description,
        entries: [
          {
            accountId: this.byCode(LEDGER_CODES.EXTERNAL_WORLD),
            direction: EntryDirection.DEBIT,
            amountCents: options.amountCents,
          },
          {
            accountId: options.ledgerAccountId,
            direction: EntryDirection.CREDIT,
            amountCents: options.amountCents,
          },
        ],
      }),
    );
  }

  /**
   * Reserva para PIX out. Duas fases: o disponivel cai agora, o postado so
   * muda quando o SPI confirmar.
   */
  async authorizePixOut(options: {
    ledgerAccountId: string;
    amountCents: bigint;
    feeCents: bigint;
    idempotencyKey: string;
    externalRef?: string;
  }): Promise<PostTransactionResult> {
    const entries: LedgerEntryInput[] = [
      {
        accountId: options.ledgerAccountId,
        direction: EntryDirection.DEBIT,
        amountCents: options.amountCents + options.feeCents,
      },
      {
        accountId: this.byCode(LEDGER_CODES.PIX_OUT_CLEARING),
        direction: EntryDirection.CREDIT,
        amountCents: options.amountCents,
      },
    ];

    if (options.feeCents > 0n) {
      entries.push({
        accountId: this.byCode(LEDGER_CODES.FEE_REVENUE),
        direction: EntryDirection.CREDIT,
        amountCents: options.feeCents,
      });
    }

    return this.run(() =>
      this.engine.post({
        type: LedgerTransactionType.PIX_OUT_AUTHORIZE,
        phase: EntryPhase.PENDING,
        idempotencyKey: options.idempotencyKey,
        externalRef: options.externalRef,
        entries,
      }),
    );
  }

  /** Efetiva a reserva e move o dinheiro para fora do banco. */
  async settlePixOut(options: {
    pendingTransactionId: string;
    amountCents: bigint;
    idempotencyKey: string;
  }): Promise<void> {
    await this.run(() =>
      this.engine.commitPending(options.pendingTransactionId, {
        idempotencyKey: options.idempotencyKey,
        type: LedgerTransactionType.PIX_OUT_SETTLE,
      }),
    );

    // Segunda perna: o clearing zera contra o mundo externo.
    await this.run(() =>
      this.engine.post({
        type: LedgerTransactionType.PIX_OUT_SETTLE,
        phase: EntryPhase.POSTED,
        idempotencyKey: `${options.idempotencyKey}-external`,
        entries: [
          {
            accountId: this.byCode(LEDGER_CODES.PIX_OUT_CLEARING),
            direction: EntryDirection.DEBIT,
            amountCents: options.amountCents,
          },
          {
            accountId: this.byCode(LEDGER_CODES.EXTERNAL_WORLD),
            direction: EntryDirection.CREDIT,
            amountCents: options.amountCents,
          },
        ],
      }),
    );
  }

  /** Libera a reserva na falha. Os lancamentos ficam com fase VOID. */
  async voidPixOut(options: {
    pendingTransactionId: string;
    idempotencyKey: string;
  }): Promise<void> {
    await this.run(() =>
      this.engine.voidPending(options.pendingTransactionId, {
        idempotencyKey: options.idempotencyKey,
        type: LedgerTransactionType.PIX_OUT_VOID,
      }),
    );
  }

  /** Devolucao: debita o cliente contra a conta de devolucoes a pagar. */
  async postRefund(options: {
    ledgerAccountId: string;
    amountCents: bigint;
    idempotencyKey: string;
    externalRef?: string;
  }): Promise<PostTransactionResult> {
    return this.run(() =>
      this.engine.post({
        type: LedgerTransactionType.PIX_REFUND_OUT,
        phase: EntryPhase.POSTED,
        idempotencyKey: options.idempotencyKey,
        externalRef: options.externalRef,
        entries: [
          {
            accountId: options.ledgerAccountId,
            direction: EntryDirection.DEBIT,
            amountCents: options.amountCents,
          },
          {
            accountId: this.byCode(LEDGER_CODES.EXTERNAL_WORLD),
            direction: EntryDirection.CREDIT,
            amountCents: options.amountCents,
          },
        ],
      }),
    );
  }

  /** Move entre disponivel e bloqueado. Bloqueio e movimento real, com extrato. */
  async blockFunds(options: {
    availableLedgerAccountId: string;
    blockedLedgerAccountId: string;
    amountCents: bigint;
    idempotencyKey: string;
    unblock?: boolean;
  }): Promise<PostTransactionResult> {
    const from = options.unblock
      ? options.blockedLedgerAccountId
      : options.availableLedgerAccountId;
    const to = options.unblock ? options.availableLedgerAccountId : options.blockedLedgerAccountId;

    return this.run(() =>
      this.engine.post({
        type: options.unblock
          ? LedgerTransactionType.UNBLOCK_FUNDS
          : LedgerTransactionType.BLOCK_FUNDS,
        phase: EntryPhase.POSTED,
        idempotencyKey: options.idempotencyKey,
        entries: [
          { accountId: from, direction: EntryDirection.DEBIT, amountCents: options.amountCents },
          { accountId: to, direction: EntryDirection.CREDIT, amountCents: options.amountCents },
        ],
      }),
    );
  }

  /** Lancamentos de uma conta, ordenados, para montar o extrato. */
  statement(ledgerAccountId: string, from: Date, to: Date) {
    return this.store
      .allEntries()
      .filter(
        (entry) =>
          entry.accountId === ledgerAccountId &&
          entry.phase !== EntryPhase.PENDING &&
          entry.effectiveAt >= from &&
          entry.effectiveAt <= to,
      )
      .sort((a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime() || a.sequence - b.sequence);
  }

  /**
   * Verifica as invariantes do razao inteiro.
   *
   * Exposto em `_control` de proposito: e o teste e2e que afirma, ao final do
   * fluxo dourado, que debitos igualam creditos nos dois ledgers.
   */
  verifyInvariants(): { ok: true } | { ok: false; violations: string[] } {
    try {
      assertInvariants(this.store.allAccounts(), this.store.allEntries());
      return { ok: true };
    } catch (error) {
      return { ok: false, violations: [(error as Error).message] };
    }
  }

  customerCodes(accountId: string): { available: string; blocked: string } {
    return { available: customerAvailableCode(accountId), blocked: customerBlockedCode(accountId) };
  }

  reset(): void {
    // Recria o store do zero; o engine mantem a referencia por closure, entao
    // trocamos o conteudo em vez do objeto.
    for (const account of this.store.allAccounts()) {
      account.debitsPosted = 0n;
      account.creditsPosted = 0n;
      account.debitsPending = 0n;
      account.creditsPending = 0n;
      account.entryCount = 0n;
    }
  }

  /** Serializa as operacoes, como o lock de linha do Postgres faria. */
  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await this.store.runExclusive(fn);
    } catch (error: unknown) {
      if (error instanceof InsufficientFundsError) {
        throw MockBankError.insufficientFunds(error.available);
      }
      throw error;
    }
  }
}
