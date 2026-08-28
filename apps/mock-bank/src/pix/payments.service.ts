import {
  buildEndToEndId,
  daysBetween,
  newId,
  PIX_REFUND_WINDOW_DAYS,
  TransactionStatus,
} from '@baasconn/taxonomy';
import { Injectable, Logger } from '@nestjs/common';

import { AccountsService } from '../accounts/accounts.service.js';
import { MockClock } from '../common/clock.provider.js';
import { MockBankError } from '../common/errors.js';
import { PixOutScenario, pixOutScenarioFor } from '../common/magic-values.js';
import { MockBankStore, MockPayment } from '../common/store.js';
import { MockBankConfig } from '../config/config.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { WebhookService } from '../webhooks/webhook.service.js';

import { ChargesService } from './charges.service.js';
import { PixKeysService } from './pix-keys.service.js';

export interface SendPixInput {
  accountId: string;
  amountCents: bigint;
  idempotencyKey?: string;
  description?: string;
  destination:
    | { kind: 'pix_key'; key: string }
    | {
        kind: 'bank_account';
        ispb: string;
        branch: string;
        number: string;
        holderName: string;
        holderTaxId: string;
      };
}

export interface ReceivePixInput {
  accountId?: string;
  pixKey?: string;
  amountCents: bigint;
  payerName: string;
  payerTaxId: string;
  payerIspb?: string;
  txid?: string;
  description?: string;
  /** Atraso antes de creditar, para simular liquidacao nao instantanea. */
  delayMs?: number;
}

/**
 * Movimentacao do Mock Bank.
 *
 * O PIX out e em duas fases de propósito: a autorizacao reserva o saldo e a
 * liquidacao efetiva minutos depois, exatamente como no SPI. E isso que faz o
 * conector exercitar o caminho pendente/liquidado em vez de assumir que
 * pagamento e atomico.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly store: MockBankStore,
    private readonly accounts: AccountsService,
    private readonly keys: PixKeysService,
    private readonly charges: ChargesService,
    private readonly ledger: LedgerService,
    private readonly clock: MockClock,
    private readonly config: MockBankConfig,
    private readonly webhooks: WebhookService,
  ) {}

  // -----------------------------------------------------------------------
  // PIX out
  // -----------------------------------------------------------------------

  async sendPix(input: SendPixInput): Promise<MockPayment> {
    // Idempotencia do provedor: a mesma chave devolve o mesmo pagamento.
    if (input.idempotencyKey) {
      const existingId = this.store.paymentsByIdempotencyKey.get(input.idempotencyKey);
      if (existingId) return this.store.payments.get(existingId)!;
    }

    const account = this.accounts.get(input.accountId);
    this.accounts.assertCanTransact(account);

    const scenario = pixOutScenarioFor(input.amountCents);

    // Valor magico de saldo insuficiente: recusa antes de tocar o ledger.
    if (scenario === PixOutScenario.INSUFFICIENT_FUNDS) {
      throw MockBankError.insufficientFunds(this.accounts.balances(account.id).available);
    }
    if (scenario === PixOutScenario.PROVIDER_ERROR) {
      throw MockBankError.injected();
    }

    this.assertWithinLimits(input.amountCents);

    const payment: MockPayment = {
      id: newId('transaction'),
      accountId: account.id,
      direction: 'out',
      status: TransactionStatus.PROCESSING,
      amountCents: input.amountCents,
      feeCents: this.config.pixOutFeeCents,
      idempotencyKey: input.idempotencyKey,
      counterparty: this.describeDestination(input),
      description: input.description,
      scenario,
      refundedCents: 0n,
      createdAt: this.clock.now(),
    };

    // Reserva no ledger. Se nao houver saldo, o CHECK do razao recusa aqui,
    // antes de qualquer efeito visivel.
    const pending = await this.ledger.authorizePixOut({
      ledgerAccountId: account.availableLedgerAccountId,
      amountCents: payment.amountCents,
      feeCents: payment.feeCents,
      idempotencyKey: `pixout-auth-${payment.id}`,
      externalRef: payment.id,
    });
    payment.ledgerPendingTransactionId = pending.transaction.id;

    // O Mock Bank e um PSP legitimo, entao pode cunhar EndToEndId. Nenhum
    // adapter de provedor real deve fazer isso.
    payment.endToEndId = buildEndToEndId({ ispb: this.config.ispb, at: this.clock.now() });

    this.persist(payment);

    // Valor magico de timeout: o pagamento fica em PROCESSING para sempre e a
    // requisicao nunca responde. E o cenario que expoe o caminho de desfecho
    // desconhecido, que a maioria das integracoes nunca testa.
    if (scenario === PixOutScenario.TIMEOUT) {
      this.logger.warn(`Pagamento ${payment.id}: cenario de timeout, a resposta sera suspensa`);
      await this.hang();
    }

    void this.settleLater(payment, scenario);
    return payment;
  }

  /** Liquidacao assincrona, com o atraso e o cenario de webhook do caso. */
  private async settleLater(payment: MockPayment, scenario: PixOutScenario): Promise<void> {
    const account = this.accounts.get(payment.accountId);

    if (scenario === PixOutScenario.OUT_OF_ORDER_WEBHOOK) {
      // Liquidado ANTES de pendente: o conector precisa absorver pelo guard
      // monotonico e nao regredir o estado.
      await this.webhooks.emit(account.clientId, 'pix_out.settled', this.paymentEvent(payment), {
        outOfOrder: true,
      });
      await this.webhooks.emit(account.clientId, 'pix_out.pending', this.paymentEvent(payment));
    } else {
      await this.webhooks.emit(account.clientId, 'pix_out.pending', this.paymentEvent(payment));
    }

    await this.sleep(this.settlementDelay());

    await this.ledger.settlePixOut({
      pendingTransactionId: payment.ledgerPendingTransactionId!,
      amountCents: payment.amountCents,
      idempotencyKey: `pixout-settle-${payment.id}`,
    });

    payment.status = TransactionStatus.SETTLED;
    payment.settledAt = this.clock.now();

    if (scenario !== PixOutScenario.OUT_OF_ORDER_WEBHOOK) {
      await this.webhooks.emit(account.clientId, 'pix_out.settled', this.paymentEvent(payment), {
        duplicate: scenario === PixOutScenario.DUPLICATE_WEBHOOK,
      });
    }

    if (scenario === PixOutScenario.AUTO_REFUND) {
      await this.sleep(this.config.isCi ? 0 : 5_000);
      await this.autoRefund(payment);
    }
  }

  // -----------------------------------------------------------------------
  // PIX in
  // -----------------------------------------------------------------------

  /** Injeta um PIX de entrada. Chamado pelo painel de controle ou por pagamento de QR. */
  async receivePix(input: ReceivePixInput): Promise<MockPayment> {
    if (input.delayMs) await this.sleep(input.delayMs);

    const resolved = input.accountId
      ? this.accounts.get(input.accountId)
      : this.resolveByKey(input.pixKey);

    const payment: MockPayment = {
      id: newId('transaction'),
      accountId: resolved?.id ?? 'suspense',
      direction: 'in',
      status: TransactionStatus.SETTLED,
      amountCents: input.amountCents,
      feeCents: 0n,
      endToEndId: buildEndToEndId({ ispb: input.payerIspb ?? '00000000', at: this.clock.now() }),
      txid: input.txid,
      counterparty: {
        name: input.payerName,
        taxId: input.payerTaxId,
        ispb: input.payerIspb,
        pixKey: input.pixKey,
      },
      description: input.description,
      scenario: 'PIX_IN',
      refundedCents: 0n,
      createdAt: this.clock.now(),
      settledAt: this.clock.now(),
    };

    // Chave que nao resolve vai para suspense e e devolvida depois: e o que
    // acontece de verdade, e o conector precisa saber lidar.
    if (!resolved) {
      this.persist(payment);
      this.logger.warn(`PIX in sem destino resolvivel (chave ${input.pixKey}); enviado a suspense`);
      return payment;
    }

    const posted = await this.ledger.creditFromExternal({
      ledgerAccountId: resolved.availableLedgerAccountId,
      amountCents: input.amountCents,
      idempotencyKey: `pixin-${payment.id}`,
      externalRef: payment.id,
      description: input.description,
    });
    payment.ledgerPostedTransactionId = posted.transaction.id;
    this.persist(payment);

    if (input.txid) {
      const charge = this.charges.markPaid(input.txid, input.amountCents, payment.id);
      await this.webhooks.emit(resolved.clientId, 'pix_charge.paid', {
        txid: charge.txid,
        status: charge.status,
        paid_amount_cents: charge.paidAmountCents.toString(),
        transaction_id: payment.id,
      });
    }

    await this.webhooks.emit(resolved.clientId, 'pix_in.received', this.paymentEvent(payment));
    return payment;
  }

  /** Paga uma cobranca pelo txid, como um pagador externo faria lendo o QR. */
  async payCharge(
    txid: string,
    payer: { name: string; taxId: string },
    amountCents?: bigint,
  ): Promise<MockPayment> {
    const charge = this.charges.get(txid);
    if (charge.status !== 'ACTIVE') {
      throw new MockBankError(
        'MB-COB-422',
        `Cobranca ${charge.status} nao aceita pagamento.`,
        422 as never,
      );
    }
    const amount = amountCents ?? charge.amountCents;
    if (!amount) {
      throw new MockBankError(
        'MB-COB-422',
        'Cobranca de valor aberto exige valor no pagamento.',
        422 as never,
      );
    }

    return this.receivePix({
      accountId: charge.accountId,
      amountCents: amount,
      payerName: payer.name,
      payerTaxId: payer.taxId,
      txid,
      description: `Pagamento da cobranca ${txid}`,
    });
  }

  // -----------------------------------------------------------------------
  // Devolucao
  // -----------------------------------------------------------------------

  async refund(input: {
    accountId: string;
    originalEndToEndId: string;
    amountCents?: bigint;
    idempotencyKey?: string;
    reasonCode: string;
  }): Promise<MockPayment> {
    if (input.idempotencyKey) {
      const existingId = this.store.paymentsByIdempotencyKey.get(input.idempotencyKey);
      if (existingId) return this.store.payments.get(existingId)!;
    }

    const originalId = this.store.paymentsByEndToEndId.get(input.originalEndToEndId);
    const original = originalId ? this.store.payments.get(originalId) : undefined;
    if (!original) throw MockBankError.transactionNotFound(input.originalEndToEndId);

    // Janela de 90 dias do BACEN, medida pelo relogio logico: os testes podem
    // avanca-lo em vez de esperar.
    const elapsed = daysBetween(original.createdAt, this.clock.now());
    if (elapsed > PIX_REFUND_WINDOW_DAYS) {
      throw MockBankError.refundWindowExpired(PIX_REFUND_WINDOW_DAYS);
    }

    const amount = input.amountCents ?? original.amountCents;
    if (original.refundedCents + amount > original.amountCents) {
      throw MockBankError.refundExceedsOriginal();
    }

    const account = this.accounts.get(input.accountId);
    const refund: MockPayment = {
      id: newId('transaction'),
      accountId: account.id,
      direction: 'out',
      status: TransactionStatus.SETTLED,
      amountCents: amount,
      feeCents: 0n,
      returnId: buildEndToEndId({ ispb: this.config.ispb, at: this.clock.now(), prefix: 'D' }),
      originalEndToEndId: input.originalEndToEndId,
      idempotencyKey: input.idempotencyKey,
      counterparty: original.counterparty,
      scenario: 'REFUND',
      refundedCents: 0n,
      createdAt: this.clock.now(),
      settledAt: this.clock.now(),
    };

    const posted = await this.ledger.postRefund({
      ledgerAccountId: account.availableLedgerAccountId,
      amountCents: amount,
      idempotencyKey: `refund-${refund.id}`,
      externalRef: refund.id,
    });
    refund.ledgerPostedTransactionId = posted.transaction.id;

    original.refundedCents += amount;
    original.status =
      original.refundedCents >= original.amountCents
        ? TransactionStatus.REVERSED
        : TransactionStatus.PARTIALLY_REVERSED;

    this.persist(refund);
    await this.webhooks.emit(account.clientId, 'pix_refund.settled', this.paymentEvent(refund));
    return refund;
  }

  private async autoRefund(payment: MockPayment): Promise<void> {
    if (!payment.endToEndId) return;
    await this.refund({
      accountId: payment.accountId,
      originalEndToEndId: payment.endToEndId,
      reasonCode: 'OPERATIONAL_ERROR',
      idempotencyKey: `auto-refund-${payment.id}`,
    }).catch((error: unknown) => {
      this.logger.warn(`Devolucao automatica de ${payment.id} falhou: ${(error as Error).message}`);
    });
  }

  // -----------------------------------------------------------------------
  // Consulta
  // -----------------------------------------------------------------------

  get(id: string): MockPayment {
    const payment = this.store.payments.get(id);
    if (!payment) throw MockBankError.transactionNotFound(id);
    return payment;
  }

  findByEndToEndId(endToEndId: string): MockPayment | undefined {
    const id = this.store.paymentsByEndToEndId.get(endToEndId);
    return id ? this.store.payments.get(id) : undefined;
  }

  /**
   * Busca pela chave de idempotencia do cliente.
   *
   * E o que permite ao conector resolver um desfecho desconhecido sem
   * reenviar o pagamento. Sem isto, o unico caminho seria reenviar.
   */
  findByIdempotencyKey(key: string): MockPayment | undefined {
    const id = this.store.paymentsByIdempotencyKey.get(key);
    return id ? this.store.payments.get(id) : undefined;
  }

  list(accountId: string, from?: Date, to?: Date): MockPayment[] {
    return [...this.store.payments.values()]
      .filter((payment) => payment.accountId === accountId)
      .filter((payment) => !from || payment.createdAt >= from)
      .filter((payment) => !to || payment.createdAt <= to)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  // -----------------------------------------------------------------------

  private persist(payment: MockPayment): void {
    this.store.payments.set(payment.id, payment);
    if (payment.idempotencyKey) {
      this.store.paymentsByIdempotencyKey.set(payment.idempotencyKey, payment.id);
    }
    if (payment.endToEndId) this.store.paymentsByEndToEndId.set(payment.endToEndId, payment.id);
  }

  private resolveByKey(pixKey?: string) {
    if (!pixKey) return undefined;
    const key = this.keys.findActive(pixKey);
    return key ? this.accounts.get(key.accountId) : undefined;
  }

  private describeDestination(input: SendPixInput): MockPayment['counterparty'] {
    if (input.destination.kind === 'pix_key') {
      const resolved = this.keys.findActive(input.destination.key);
      if (!resolved) throw MockBankError.pixKeyNotFound(input.destination.key);
      const account = this.accounts.get(resolved.accountId);
      return {
        name: account.holderName,
        taxId: account.holderTaxId,
        ispb: account.ispb,
        branch: account.branch,
        accountNumber: account.number,
        pixKey: resolved.value,
      };
    }
    return {
      name: input.destination.holderName,
      taxId: input.destination.holderTaxId,
      ispb: input.destination.ispb,
      branch: input.destination.branch,
      accountNumber: input.destination.number,
    };
  }

  private assertWithinLimits(amountCents: bigint): void {
    const hour = this.clock.now().getHours();
    const nightly = hour >= 20 || hour < 6;
    const limit = nightly ? this.config.nightlyPixOutLimitCents : this.config.dailyPixOutLimitCents;
    if (amountCents > limit) throw MockBankError.limitExceeded(limit);
  }

  private paymentEvent(payment: MockPayment): Record<string, unknown> {
    return {
      transaction_id: payment.id,
      account_id: payment.accountId,
      direction: payment.direction,
      status: payment.status,
      amount_cents: payment.amountCents.toString(),
      fee_cents: payment.feeCents.toString(),
      end_to_end_id: payment.endToEndId,
      return_id: payment.returnId,
      txid: payment.txid,
      counterparty: payment.counterparty,
      created_at: payment.createdAt.toISOString(),
      settled_at: payment.settledAt?.toISOString(),
    };
  }

  private settlementDelay(): number {
    if (this.config.isCi) return 0;
    const { settlementDelayMinMs: min, settlementDelayMaxMs: max } = this.config;
    return min + Math.floor(Math.random() * Math.max(max - min, 1));
  }

  /** Nunca resolve: o cliente sofre timeout e nao sabe o desfecho. */
  private hang(): Promise<never> {
    return new Promise(() => {});
  }

  private sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
