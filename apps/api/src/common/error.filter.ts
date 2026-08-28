import { getContext } from '@baasconn/observability';
import { BaasError, BaasErrorCode } from '@baasconn/taxonomy';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';

import { ApiConfig } from '../config/config.service.js';

/**
 * Filtro global de erro.
 *
 * Toda resposta de erro da API sai daqui, no envelope canonico. Nenhuma
 * excecao vaza forma interna: um TypeError nao vira 500 com stack trace no
 * corpo, e um erro de provedor nao vira JSON do provedor.
 */
@Catch()
@Injectable()
export class CanonicalErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(CanonicalErrorFilter.name);

  constructor(private readonly config: ApiConfig) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const requestId = getContext()?.requestId;

    const error = this.toCanonical(exception);
    const body = error.toJSON({ includeProviderMessage: this.config.exposeProviderMessages }) as {
      error: Record<string, unknown>;
    };
    if (requestId) body.error.request_id = requestId;

    if (error.retryAfterSeconds !== undefined) {
      response.setHeader('Retry-After', String(error.retryAfterSeconds));
    }
    if (requestId) response.setHeader('X-Request-Id', requestId);

    // 5xx e incidente nosso; 4xx e o cliente sendo informado de uma regra.
    if (error.httpStatus >= 500) {
      this.logger.error(
        { err: exception, path: request.path, code: error.code, request_id: requestId },
        'Erro interno',
      );
    } else {
      this.logger.debug({ path: request.path, code: error.code, request_id: requestId }, 'Erro de cliente');
    }

    response.status(error.httpStatus).json(body);
  }

  private toCanonical(exception: unknown): BaasError {
    if (exception instanceof BaasError) return exception;

    if (exception instanceof ZodError) {
      return new BaasError(BaasErrorCode.VALIDATION_ERROR, {
        details: exception.issues.map((issue) => ({
          field: issue.path.join('.') || undefined,
          code: issue.code,
          message: issue.message,
        })),
      });
    }

    if (exception instanceof HttpException) {
      return new BaasError(this.fromHttpStatus(exception.getStatus()), {
        message: exception.message,
        cause: exception,
      });
    }

    // Qualquer outra coisa e bug nosso: mensagem generica, detalhe so no log.
    return new BaasError(BaasErrorCode.INTERNAL_ERROR, { cause: exception });
  }

  private fromHttpStatus(status: number): BaasErrorCode {
    switch (status) {
      case 400:
        return BaasErrorCode.VALIDATION_ERROR;
      case 401:
        return BaasErrorCode.AUTHENTICATION_FAILED;
      case 403:
        return BaasErrorCode.AUTHORIZATION_DENIED;
      case 404:
        return BaasErrorCode.RESOURCE_NOT_FOUND;
      case 409:
        return BaasErrorCode.RESOURCE_ALREADY_EXISTS;
      case 422:
        return BaasErrorCode.VALIDATION_ERROR;
      case 429:
        return BaasErrorCode.RATE_LIMITED;
      case 501:
        return BaasErrorCode.NOT_IMPLEMENTED;
      default:
        return status >= 500 ? BaasErrorCode.INTERNAL_ERROR : BaasErrorCode.VALIDATION_ERROR;
    }
  }
}
