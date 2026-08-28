import { type BaasErrorCategory, BaasErrorCode, ERROR_CODE_META } from './codes.js';
import { ERROR_MESSAGES_PT_BR } from './messages.js';

export const ERROR_DOCS_BASE_URL = 'https://docs.baas-connector.dev/errors';

export interface ErrorDetail {
  field?: string;
  code?: string;
  message: string;
}

export interface ProviderErrorContext {
  slug: string;
  /** Codigo do provedor preservado literalmente, para escalacao ao suporte. */
  code?: string;
  message?: string;
  httpStatus?: number;
  requestId?: string;
}

export interface BaasErrorInit {
  message?: string;
  details?: ErrorDetail[];
  provider?: ProviderErrorContext;
  requestId?: string;
  /** Sobrescreve a decisao padrao do catalogo (ex.: 429 com Retry-After). */
  retryable?: boolean;
  safeToRetry?: boolean;
  retryAfterSeconds?: number;
  cause?: unknown;
  meta?: Record<string, unknown>;
}

/** Erro canonico do conector. Todo erro exposto na API passa por aqui. */
export class BaasError extends Error {
  readonly code: BaasErrorCode;
  readonly category: BaasErrorCategory;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly safeToRetry: boolean;
  readonly retryAfterSeconds?: number;
  readonly details?: ErrorDetail[];
  readonly provider?: ProviderErrorContext;
  readonly requestId?: string;
  readonly meta?: Record<string, unknown>;

  constructor(code: BaasErrorCode, init: BaasErrorInit = {}) {
    const info = ERROR_CODE_META[code];
    super(init.message ?? ERROR_MESSAGES_PT_BR[code] ?? code, { cause: init.cause });
    this.name = 'BaasError';
    this.code = code;
    this.category = info.category;
    this.httpStatus = info.httpStatus;
    this.retryable = init.retryable ?? info.retryable;
    this.safeToRetry = init.safeToRetry ?? info.safeToRetry;
    if (init.retryAfterSeconds !== undefined) this.retryAfterSeconds = init.retryAfterSeconds;
    if (init.details) this.details = init.details;
    if (init.provider) this.provider = init.provider;
    if (init.requestId) this.requestId = init.requestId;
    if (init.meta) this.meta = init.meta;
    Error.captureStackTrace?.(this, BaasError);
  }

  get docsUrl(): string {
    return `${ERROR_DOCS_BASE_URL}/${this.code}`;
  }

  get messagePtBr(): string {
    return ERROR_MESSAGES_PT_BR[this.code] ?? this.message;
  }

  static is(value: unknown): value is BaasError {
    return value instanceof BaasError;
  }

  /**
   * Envelope de erro da API.
   *
   * `includeProviderMessage` fica falso em producao por padrao: a mensagem
   * crua do provedor pode carregar detalhe interno. O `provider.code` sempre
   * vai, porque e o que o suporte usa para escalar.
   */
  toJSON(options: { includeProviderMessage?: boolean } = {}): Record<string, unknown> {
    const provider = this.provider
      ? {
          slug: this.provider.slug,
          ...(this.provider.code ? { code: this.provider.code } : {}),
          ...(options.includeProviderMessage && this.provider.message
            ? { message: this.provider.message }
            : {}),
          ...(this.provider.requestId ? { request_id: this.provider.requestId } : {}),
        }
      : undefined;

    return {
      error: {
        code: this.code,
        category: this.category,
        message: this.message,
        message_ptbr: this.messagePtBr,
        retryable: this.retryable,
        docs_url: this.docsUrl,
        ...(this.details?.length ? { details: this.details } : {}),
        ...(this.requestId ? { request_id: this.requestId } : {}),
        ...(provider ? { provider } : {}),
      },
    };
  }
}

/** Capacidade nao suportada pelo provedor configurado. Vira 501. */
export class CapabilityNotSupportedError extends BaasError {
  constructor(
    readonly providerSlug: string,
    readonly capability: string,
    note?: string,
  ) {
    super(BaasErrorCode.CAPABILITY_NOT_SUPPORTED, {
      message: `O provedor '${providerSlug}' nao suporta a capacidade '${capability}'.${note ? ` ${note}` : ''}`,
      meta: { provider: providerSlug, capability, ...(note ? { note } : {}) },
    });
    this.name = 'CapabilityNotSupportedError';
  }
}

/**
 * Escrita cujo desfecho e indeterminado.
 *
 * Lancado quando um POST que move dinheiro sofre timeout de headers ou body.
 * Nunca deve ser convertido em retry: a camada de aplicacao roda o caminho de
 * conciliacao (reconcile-on-unknown).
 */
export class ProviderOutcomeUnknownError extends BaasError {
  constructor(
    readonly providerSlug: string,
    readonly operationId: string,
    init: BaasErrorInit = {},
  ) {
    super(BaasErrorCode.PROVIDER_OUTCOME_UNKNOWN, {
      ...init,
      safeToRetry: false,
      retryable: false,
      meta: { ...init.meta, provider: providerSlug, operationId },
    });
    this.name = 'ProviderOutcomeUnknownError';
  }
}

export class InvalidStateTransitionError extends BaasError {
  constructor(entity: string, from: string, to: string) {
    super(BaasErrorCode.INVALID_STATE_TRANSITION, {
      message: `Transicao invalida em ${entity}: ${from} -> ${to}`,
      meta: { entity, from, to },
    });
    this.name = 'InvalidStateTransitionError';
  }
}
