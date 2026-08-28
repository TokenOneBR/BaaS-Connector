import { runWithContext, type RequestContext } from '@baasconn/observability';
import { newId, type Clock } from '@baasconn/taxonomy';
import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { CLOCK } from './clock.js';

/**
 * Estabelece o contexto de requisicao.
 *
 * Roda antes de tudo, para que todo log da requisicao ja saia correlacionado,
 * inclusive os de erro de autenticacao.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(@Inject(CLOCK) private readonly clock: Clock) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const inbound = request.headers['x-request-id'];
    const requestId = typeof inbound === 'string' && inbound.length > 0 ? inbound : newId('event');

    const correlationHeader = request.headers['x-correlation-id'];
    const correlationId =
      typeof correlationHeader === 'string' && correlationHeader.length > 0
        ? correlationHeader
        : requestId;

    response.setHeader('X-Request-Id', requestId);

    const context: RequestContext = {
      requestId,
      correlationId,
      startedAtMs: this.clock.now().getTime(),
    };

    runWithContext(context, () => next());
  }
}
