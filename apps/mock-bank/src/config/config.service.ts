import { Injectable } from '@nestjs/common';

export type MockBankStore = 'memory' | 'postgres';

/**
 * Configuracao do Mock Bank.
 *
 * Os atrasos vao a zero no CI para a suite ficar deterministica e rapida; em
 * desenvolvimento eles existem porque um provedor que responde instantaneamente
 * esconde exatamente os bugs de assincronia que este servico existe para
 * expor.
 */
@Injectable()
export class MockBankConfig {
  readonly store: MockBankStore = (process.env.MOCK_BANK_STORE as MockBankStore) ?? 'memory';
  readonly port = Number(process.env.PORT ?? 3002);
  readonly ispb = process.env.MOCK_BANK_ISPB ?? '99999001';
  readonly bankCode = process.env.MOCK_BANK_CODE ?? '999';
  readonly branch = process.env.MOCK_BANK_BRANCH ?? '0001';

  readonly clientId = process.env.MOCK_BANK_CLIENT_ID ?? 'mock-client';
  readonly clientSecret = process.env.MOCK_BANK_CLIENT_SECRET ?? 'mock-secret';
  readonly webhookSecret = process.env.MOCK_BANK_WEBHOOK_SECRET ?? 'dev-mock-secret';
  readonly tokenTtlSeconds = Number(process.env.MOCK_BANK_TOKEN_TTL ?? 900);

  readonly approvalDelayMs = Number(process.env.MOCK_APPROVAL_DELAY_MS ?? 1500);
  readonly reviewDelayMs = Number(process.env.MOCK_REVIEW_DELAY_MS ?? 3000);
  readonly settlementDelayMinMs = Number(process.env.MOCK_SETTLEMENT_DELAY_MIN_MS ?? 400);
  readonly settlementDelayMaxMs = Number(process.env.MOCK_SETTLEMENT_DELAY_MAX_MS ?? 2000);

  /** Tarifa fixa de PIX out, em centavos. */
  readonly pixOutFeeCents = BigInt(process.env.MOCK_PIX_OUT_FEE_CENTS ?? '0');

  readonly dailyPixOutLimitCents = BigInt(process.env.MOCK_DAILY_PIX_LIMIT_CENTS ?? '2000000');
  readonly nightlyPixOutLimitCents = BigInt(process.env.MOCK_NIGHTLY_PIX_LIMIT_CENTS ?? '100000');

  /** Chaos fica desligado por padrao: o CI precisa ser deterministico. */
  readonly chaosLatencyMs = Number(process.env.MOCK_CHAOS_LATENCY_MS ?? 0);
  readonly chaosErrorRate = Number(process.env.MOCK_CHAOS_ERROR_RATE ?? 0);
  readonly chaosWebhookDupRate = Number(process.env.MOCK_CHAOS_WEBHOOK_DUP_RATE ?? 0);
  readonly chaosWebhookReorderRate = Number(process.env.MOCK_CHAOS_WEBHOOK_REORDER_RATE ?? 0);

  get isCi(): boolean {
    return process.env.CI === 'true' || process.env.NODE_ENV === 'test';
  }
}
