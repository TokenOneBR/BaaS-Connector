import { describe, expect, it } from 'vitest';

import {
  BaasError,
  BaasErrorCode,
  CapabilityNotSupportedError,
  ERROR_CODE_META,
  ERROR_MESSAGES_PT_BR,
  ProviderOutcomeUnknownError,
} from './index.js';

describe('catalogo de erros', () => {
  it('tem metadados para todo codigo, sem lacuna', () => {
    for (const code of Object.values(BaasErrorCode)) {
      expect(ERROR_CODE_META, code).toHaveProperty(code);
    }
  });

  it('tem mensagem pt-BR para todo codigo exposto ao cliente', () => {
    const internalOnly = new Set([BaasErrorCode.LEDGER_UNBALANCED]);
    for (const code of Object.values(BaasErrorCode)) {
      if (internalOnly.has(code)) continue;
      expect(ERROR_MESSAGES_PT_BR[code], `sem mensagem pt-BR para ${code}`).toBeDefined();
    }
  });

  it('mapeia insufficient_funds para 422, nao 402', () => {
    // 402 nao tem semantica acordada e confunde gateways intermediarios.
    expect(ERROR_CODE_META[BaasErrorCode.INSUFFICIENT_FUNDS].httpStatus).toBe(422);
  });

  it('mapeia capability_not_supported para 501', () => {
    expect(ERROR_CODE_META[BaasErrorCode.CAPABILITY_NOT_SUPPORTED].httpStatus).toBe(501);
  });
});

describe('safeToRetry versus retryable', () => {
  it('timeout de provedor e retentavel mas nao seguro para escrita', () => {
    const meta = ERROR_CODE_META[BaasErrorCode.PROVIDER_TIMEOUT];
    expect(meta.retryable).toBe(true);
    expect(meta.safeToRetry).toBe(false);
  });

  it('rate limit e retentavel e seguro', () => {
    const meta = ERROR_CODE_META[BaasErrorCode.PROVIDER_RATE_LIMITED];
    expect(meta.retryable).toBe(true);
    expect(meta.safeToRetry).toBe(true);
  });

  it('desfecho desconhecido nunca e retentavel nem seguro', () => {
    const meta = ERROR_CODE_META[BaasErrorCode.PROVIDER_OUTCOME_UNKNOWN];
    expect(meta.retryable).toBe(false);
    expect(meta.safeToRetry).toBe(false);
  });

  it('desfecho desconhecido responde 202, jamais 5xx', () => {
    // Um 5xx convidaria o cliente a retentar, que e exatamente o risco de
    // pagamento duplo que este estado existe para evitar.
    expect(ERROR_CODE_META[BaasErrorCode.PROVIDER_OUTCOME_UNKNOWN].httpStatus).toBe(202);
  });
});

describe('BaasError', () => {
  it('serializa o envelope da API com codigo do provedor preservado', () => {
    const error = new BaasError(BaasErrorCode.INSUFFICIENT_FUNDS, {
      requestId: 'req_01',
      provider: { slug: 'CELCOIN', code: 'CBE009', message: 'saldo insuficiente' },
      details: [{ field: 'amount', message: 'excede o saldo disponivel' }],
    });

    const json = error.toJSON() as { error: Record<string, unknown> };
    expect(json.error.code).toBe('INSUFFICIENT_FUNDS');
    expect(json.error.category).toBe('BUSINESS_RULE');
    expect(json.error.message_ptbr).toBe('Saldo insuficiente para a operacao.');
    expect(json.error.docs_url).toContain('INSUFFICIENT_FUNDS');
    expect(json.error.provider).toEqual({ slug: 'CELCOIN', code: 'CBE009' });
  });

  it('so inclui a mensagem crua do provedor quando explicitamente pedido', () => {
    const error = new BaasError(BaasErrorCode.PROVIDER_REJECTED, {
      provider: { slug: 'CELCOIN', code: 'X1', message: 'detalhe interno' },
    });
    const withMessage = error.toJSON({ includeProviderMessage: true }) as {
      error: { provider: Record<string, unknown> };
    };
    expect(withMessage.error.provider.message).toBe('detalhe interno');
  });

  it('CapabilityNotSupportedError nomeia provedor e capacidade', () => {
    const error = new CapabilityNotSupportedError('WOOVI', 'onboarding.kyb.submit', 'Sem KYB.');
    expect(error.httpStatus).toBe(501);
    expect(error.message).toContain('WOOVI');
    expect(error.message).toContain('onboarding.kyb.submit');
    expect(error.message).toContain('Sem KYB.');
  });

  it('ProviderOutcomeUnknownError forca safeToRetry falso', () => {
    const error = new ProviderOutcomeUnknownError('CELCOIN', 'opr_01', { retryable: true });
    expect(error.safeToRetry).toBe(false);
    expect(error.retryable).toBe(false);
  });
});
