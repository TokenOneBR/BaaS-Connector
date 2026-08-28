import { Money } from '@baasconn/taxonomy';
import { Body, Controller, Get, Post } from '@nestjs/common';

import { TokenService } from '../common/auth.guard.js';
import { MockClock } from '../common/clock.provider.js';
import { MAGIC_VALUE_REFERENCE } from '../common/magic-values.js';
import { DEFAULT_FAULTS, MockBankStore } from '../common/store.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { OnboardingService } from '../onboarding/onboarding.service.js';
import { PaymentsService } from '../pix/payments.service.js';
import { WebhookService } from '../webhooks/webhook.service.js';

/**
 * Painel de controle do Mock Bank.
 *
 * Deliberadamente sem autenticacao forte: e um banco falso para testes, e o
 * SECURITY.md coloca este servico explicitamente fora do escopo de seguranca.
 * O chart Helm o mantem desabilitado por padrao e ele nunca deve ser exposto.
 *
 * Este e o painel que torna a premissa "Mock Bank para testes" usavel por QA e
 * em demo, nao apenas pela suite automatizada.
 */
@Controller('_control')
export class ControlController {
  constructor(
    private readonly store: MockBankStore,
    private readonly clock: MockClock,
    private readonly ledger: LedgerService,
    private readonly payments: PaymentsService,
    private readonly onboarding: OnboardingService,
    private readonly webhooks: WebhookService,
    private readonly tokens: TokenService,
  ) {}

  @Get('magic')
  magicValues() {
    return MAGIC_VALUE_REFERENCE;
  }

  @Post('webhook-url')
  setWebhookUrl(@Body() body: { client_id: string; url: string }) {
    this.webhooks.registerUrl(body.client_id, body.url);
    return { registered: true, url: body.url };
  }

  @Get('webhooks')
  deliveries() {
    return { data: this.webhooks.log };
  }

  @Post('webhooks/clear')
  clearDeliveries() {
    this.webhooks.clearLog();
    return { cleared: true };
  }

  // --------------------------- injecao de falha ---------------------------

  @Get('faults')
  getFaults() {
    return this.store.faults;
  }

  @Post('faults')
  setFaults(
    @Body()
    body: Partial<{
      latency_ms: number;
      error_rate: number;
      force_status: number | null;
      duplicate_webhooks: boolean;
      reorder_webhooks: boolean;
      invalid_signature: boolean;
    }>,
  ) {
    this.store.faults = {
      latencyMs: body.latency_ms ?? this.store.faults.latencyMs,
      errorRate: body.error_rate ?? this.store.faults.errorRate,
      forceStatus:
        body.force_status === null
          ? undefined
          : (body.force_status ?? this.store.faults.forceStatus),
      duplicateWebhooks: body.duplicate_webhooks ?? this.store.faults.duplicateWebhooks,
      reorderWebhooks: body.reorder_webhooks ?? this.store.faults.reorderWebhooks,
      invalidSignature: body.invalid_signature ?? this.store.faults.invalidSignature,
    };
    return this.store.faults;
  }

  @Post('faults/clear')
  clearFaults() {
    this.store.faults = { ...DEFAULT_FAULTS };
    return this.store.faults;
  }

  // --------------------------- relogio ---------------------------

  @Get('clock')
  getClock() {
    return { now: this.clock.now().toISOString() };
  }

  /**
   * Avanca o relogio logico.
   *
   * Existe para testar a janela de 90 dias da devolucao, expiracao de cobranca
   * e de onboarding sem `sleep`. Um teste que espera 90 dias nao e um teste.
   */
  @Post('clock/advance')
  advanceClock(@Body() body: { seconds?: number; days?: number }) {
    const seconds = (body.seconds ?? 0) + (body.days ?? 0) * 86_400;
    return { now: this.clock.advanceSeconds(seconds).toISOString(), advanced_seconds: seconds };
  }

  @Post('clock/reset')
  resetClock() {
    this.clock.reset();
    return { now: this.clock.now().toISOString() };
  }

  // --------------------------- simulacao ---------------------------

  /** Injeta um PIX de entrada, como se um terceiro tivesse pagado. */
  @Post('pix/inbound')
  async injectInboundPix(
    @Body()
    body: {
      account_id?: string;
      pix_key?: string;
      amount: string;
      payer_name?: string;
      payer_tax_id?: string;
      txid?: string;
      delay_ms?: number;
    },
  ) {
    const payment = await this.payments.receivePix({
      accountId: body.account_id,
      pixKey: body.pix_key,
      amountCents: Money.fromDecimalString(body.amount).cents,
      payerName: body.payer_name ?? 'Pagador Simulado',
      payerTaxId: body.payer_tax_id ?? '52998224725',
      txid: body.txid,
      delayMs: body.delay_ms,
    });
    return { transaction_id: payment.id, end_to_end_id: payment.endToEndId };
  }

  /** Paga uma cobranca pelo txid, como quem le o QR Code. */
  @Post('pix/pay-charge')
  async payCharge(
    @Body() body: { txid: string; amount?: string; payer_name?: string; payer_tax_id?: string },
  ) {
    const payment = await this.payments.payCharge(
      body.txid,
      { name: body.payer_name ?? 'Pagador Simulado', taxId: body.payer_tax_id ?? '52998224725' },
      body.amount ? Money.fromDecimalString(body.amount).cents : undefined,
    );
    return { transaction_id: payment.id, end_to_end_id: payment.endToEndId };
  }

  @Post('onboarding/decide')
  forceOnboardingDecision(
    @Body()
    body: {
      onboarding_id: string;
      decision: 'APPROVE' | 'REJECT' | 'PENDING';
      reason?: string;
    },
  ) {
    const onboarding = this.onboarding.forceDecision(
      body.onboarding_id,
      body.decision,
      body.reason,
    );
    return { onboarding_id: onboarding.id, status: onboarding.status };
  }

  /**
   * Faz o Mock Bank "esquecer" uma transacao.
   *
   * Existe para o teste de conciliacao: e como se produz uma quebra
   * MISSING_ON_PROVIDER de forma determinística.
   */
  @Post('forget-transaction')
  forget(@Body() body: { transaction_id: string }) {
    const payment = this.store.payments.get(body.transaction_id);
    if (!payment) return { forgotten: false };
    this.store.payments.delete(payment.id);
    if (payment.endToEndId) this.store.paymentsByEndToEndId.delete(payment.endToEndId);
    if (payment.idempotencyKey) this.store.paymentsByIdempotencyKey.delete(payment.idempotencyKey);
    return { forgotten: true, transaction_id: payment.id };
  }

  // --------------------------- invariantes ---------------------------

  /**
   * Verifica que debitos igualam creditos no razao inteiro.
   *
   * O teste e2e chama isto no final do fluxo dourado: se o Mock Bank e o
   * conector fecharem os dois, o fluxo esta correto de ponta a ponta.
   */
  @Get('ledger/verify')
  verifyLedger() {
    return this.ledger.verifyInvariants();
  }

  @Post('reset')
  reset() {
    this.store.reset();
    this.clock.reset();
    this.webhooks.clearLog();
    this.tokens.revokeAll();
    return { reset: true };
  }
}
