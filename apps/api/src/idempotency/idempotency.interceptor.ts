import { createHash } from 'node:crypto';

import { enrichContext } from '@baasconn/observability';
import {
  BaasError,
  BaasErrorCode,
  ProviderOutcomeUnknownError,
  type Clock,
  type Environment,
} from '@baasconn/taxonomy';
import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, from, Observable } from 'rxjs';

import type { AuthedRequest } from '../auth/api-key.guard.js';
import { CLOCK } from '../common/clock.js';

import {
  DEFAULT_LEASE_SECONDS,
  IDEMPOTENCY_REQUIRED_CLASSES,
  IDEMPOTENCY_REPOSITORY,
  IDEMPOTENCY_TTL_SECONDS,
  type IdempotencyRepository,
} from './idempotency.types.js';

export const IDEMPOTENT_KEY = 'baas:idempotent';

export interface IdempotentOptions {
  /** Classe da operacao: define TTL e se a chave e obrigatoria. */
  operationClass: keyof typeof IDEMPOTENCY_TTL_SECONDS;
}

export const Idempotent = (options: IdempotentOptions) => SetMetadata(IDEMPOTENT_KEY, options);

/**
 * Idempotencia de ponta a ponta.
 *
 * Duas camadas explicitamente separadas: a `Idempotency-Key` do cliente vive
 * aqui; o `operationId` que este registro cunha e o que vai ao provedor.
 * Confundir as duas quebra assim que um cliente repete a chave depois de um
 * 500 que aconteceu DEPOIS de o provedor aceitar o pagamento.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    @Inject(IDEMPOTENCY_REPOSITORY) private readonly repository: IdempotencyRepository,
    private readonly reflector: Reflector,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.getAllAndOverride<IdempotentOptions>(IDEMPOTENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return next.handle();

    return from(this.handle(context, next, options));
  }

  private async handle(
    context: ExecutionContext,
    next: CallHandler,
    options: IdempotentOptions,
  ): Promise<unknown> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const response = context.switchToHttp().getResponse<{
      status(code: number): unknown;
      setHeader(name: string, value: string): void;
    }>();

    const key = String(request.headers['idempotency-key'] ?? '').trim();
    const required = IDEMPOTENCY_REQUIRED_CLASSES.has(options.operationClass);

    if (!key) {
      if (!required) return firstValueFrom(next.handle());
      throw new BaasError(BaasErrorCode.MISSING_IDEMPOTENCY_KEY, {
        message:
          'Esta operacao movimenta dinheiro e exige o cabecalho Idempotency-Key. ' +
          'Use o mesmo valor ao repetir a requisicao.',
      });
    }

    this.assertKeyFormat(key);

    const apiKey = request.apiKey;
    if (!apiKey) throw new BaasError(BaasErrorCode.AUTHENTICATION_FAILED);

    const endpointKey = `${request.method} ${context.getClass().name}.${context.getHandler().name}`;
    const fingerprint = fingerprintRequest(request);
    const ttlSeconds =
      IDEMPOTENCY_TTL_SECONDS[options.operationClass] ?? IDEMPOTENCY_TTL_SECONDS.default!;

    const claim = await this.repository.claim({
      environment: apiKey.environment as Environment,
      apiKeyId: apiKey.id,
      endpointKey,
      key,
      requestFingerprint: fingerprint,
      leaseSeconds: DEFAULT_LEASE_SECONDS,
      ttlSeconds,
    });

    if (!claim.claimed) {
      return this.resolveConflict(claim.record, fingerprint, endpointKey, response, next, request);
    }

    enrichContext({ operationId: claim.record.operationId, idempotencyKey: key });
    (request as { operationId?: string }).operationId = claim.record.operationId;
    response.setHeader('Idempotency-Key', key);

    return this.execute(next, claim.record.id, claim.record.operationId, response);
  }

  /**
   * Resolve um conflito de chave.
   *
   * Cada ramo aqui e uma decisao com consequencia: replay devolve exatamente o
   * que foi devolvido antes; fingerprint diferente e erro do cliente; lease
   * vivo e "aguarde"; lease abandonado pode ser roubado, mas quem rouba
   * PRECISA reconciliar antes de reexecutar.
   */
  private async resolveConflict(
    record: Awaited<ReturnType<IdempotencyRepository['claim']>>['record'],
    fingerprint: string,
    endpointKey: string,
    response: { status(code: number): unknown; setHeader(name: string, value: string): void },
    next: CallHandler,
    request: AuthedRequest,
  ): Promise<unknown> {
    if (record.requestFingerprint !== fingerprint) {
      throw new BaasError(BaasErrorCode.IDEMPOTENCY_KEY_REUSED, {
        message:
          'Esta Idempotency-Key ja foi usada com um corpo de requisicao diferente. ' +
          'Use uma chave nova para uma operacao diferente.',
        meta: { endpoint: endpointKey },
      });
    }

    if (record.state === 'COMPLETED' || record.state === 'FAILED') {
      response.setHeader('Idempotency-Replayed', 'true');
      response.status(record.responseStatus ?? 200);
      return record.responseBody;
    }

    const leaseAlive = record.leaseExpiresAt && record.leaseExpiresAt > this.clock.now();
    if (leaseAlive) {
      throw new BaasError(BaasErrorCode.IDEMPOTENT_REQUEST_IN_PROGRESS, {
        retryAfterSeconds: 2,
        message: 'Uma requisicao com esta Idempotency-Key ainda esta em processamento.',
      });
    }

    const stolen = await this.repository.stealLease(record.id, DEFAULT_LEASE_SECONDS);
    if (!stolen) {
      // Outro pod ganhou a corrida pelo lease.
      throw new BaasError(BaasErrorCode.IDEMPOTENT_REQUEST_IN_PROGRESS, { retryAfterSeconds: 2 });
    }

    enrichContext({ operationId: stolen.operationId });
    (request as { operationId?: string; reconcileBeforeExecute?: boolean }).operationId =
      stolen.operationId;
    // O handler precisa consultar o provedor pela nossa chave antes de
    // reexecutar: a tentativa anterior pode ter chegado la.
    (request as { reconcileBeforeExecute?: boolean }).reconcileBeforeExecute = true;

    return this.execute(next, stolen.id, stolen.operationId, response);
  }

  private async execute(
    next: CallHandler,
    recordId: string,
    operationId: string,
    response: { status(code: number): unknown; setHeader(name: string, value: string): void },
  ): Promise<unknown> {
    // O cliente precisa do operationId mesmo quando a resposta e um 202 de
    // desfecho desconhecido: e por ele que se consulta /v1/operations/:id, e
    // e ele que aparece no ticket quando o suporte precisa achar a operacao.
    response.setHeader('X-Baas-Operation-Id', operationId);

    try {
      const result = await firstValueFrom(next.handle());
      await this.repository.complete({
        id: recordId,
        status: 200,
        body: result,
        state: 'COMPLETED',
      });
      return result;
    } catch (error) {
      await this.onFailure(recordId, operationId, error);
      throw error;
    }
  }

  /**
   * Decide o que fazer com o registro quando o handler falha.
   *
   * A distincao que importa: falha DETERMINISTICA (que sempre vai recorrer)
   * fica gravada e e reproduzida no retry; falha transitoria libera o registro
   * para o cliente ter uma tentativa nova.
   *
   * A EXCECAO e desfecho desconhecido, e ela e a razao de todo o mecanismo:
   * ali o registro NAO e liberado, porque liberar permitiria pagamento duplo.
   */
  private async onFailure(recordId: string, operationId: string, error: unknown): Promise<void> {
    if (error instanceof ProviderOutcomeUnknownError) {
      // Mantem IN_FLIGHT com o lease correndo; a conciliacao resolve.
      await this.repository.renewLease(recordId, DEFAULT_LEASE_SECONDS);
      return;
    }

    if (error instanceof BaasError && isDeterministic(error)) {
      await this.repository.complete({
        id: recordId,
        status: error.httpStatus,
        body: error.toJSON(),
        state: 'FAILED',
        errorCode: error.code,
      });
      return;
    }

    await this.repository.release(recordId);
    void operationId;
  }

  private assertKeyFormat(key: string): void {
    if (key.length < 8 || key.length > 255 || !/^[A-Za-z0-9_\-:.]+$/.test(key)) {
      throw new BaasError(BaasErrorCode.VALIDATION_ERROR, {
        details: [
          {
            field: 'Idempotency-Key',
            message: 'Use de 8 a 255 caracteres, apenas letras, digitos e _-:.',
          },
        ],
      });
    }
  }
}

/**
 * Falha que vai recorrer identicamente se o cliente repetir.
 *
 * Reproduzir o erro gravado poupa uma ida ao provedor e mantem a resposta
 * estavel. Falha transitoria nao entra aqui: ali o cliente merece uma
 * tentativa de verdade.
 */
export function isDeterministic(error: BaasError): boolean {
  const deterministic: readonly BaasErrorCode[] = [
    BaasErrorCode.VALIDATION_ERROR,
    BaasErrorCode.INVALID_TAX_ID,
    BaasErrorCode.INVALID_PIX_KEY,
    BaasErrorCode.INVALID_AMOUNT,
    BaasErrorCode.INSUFFICIENT_FUNDS,
    BaasErrorCode.ACCOUNT_NOT_ACTIVE,
    BaasErrorCode.ACCOUNT_BLOCKED,
    BaasErrorCode.CAPABILITY_NOT_SUPPORTED,
    BaasErrorCode.CAPABILITY_CONSTRAINT_VIOLATED,
    BaasErrorCode.REFUND_WINDOW_EXPIRED,
    BaasErrorCode.REFUND_AMOUNT_EXCEEDS_ORIGINAL,
    BaasErrorCode.CHARGE_EXPIRED,
    BaasErrorCode.INSUFFICIENT_SCOPE,
  ];
  return deterministic.includes(error.code);
}

/**
 * Impressao digital da requisicao.
 *
 * Canonicaliza o JSON (ordena as chaves) para a mesma requisicao com ordem de
 * campo diferente nao ser tratada como requisicao diferente.
 */
export function fingerprintRequest(request: {
  body?: unknown;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
}): string {
  const payload = canonicalJson({
    body: request.body ?? null,
    params: request.params ?? {},
    connectionId: (request.query as Record<string, unknown> | undefined)?.connection_id ?? null,
  });
  return createHash('sha256').update(payload).digest('hex');
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(',')}}`;
}
