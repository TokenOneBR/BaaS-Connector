import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

/** Limite do corpo de webhook. Provedor legitimo nao passa disso. */
export const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;

/**
 * Captura os bytes crus do corpo, ANTES do parse JSON.
 *
 * Verificacao de assinatura precisa dos bytes EXATOS: reserializar o JSON muda
 * espacamento e ordem de chave, e a assinatura deixa de conferir. Este e o bug
 * mais comum de integracao de webhook.
 */
@Injectable()
export class RawBodyMiddleware implements NestMiddleware {
  use(request: RawBodyRequest, response: Response, next: NextFunction): void {
    const chunks: Buffer[] = [];
    let size = 0;

    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_WEBHOOK_BODY_BYTES) {
        response.status(413).json({
          error: { code: 'PAYLOAD_TOO_LARGE', message: 'Corpo de webhook acima de 1 MiB.' },
        });
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on('end', () => {
      request.rawBody = Buffer.concat(chunks);
      // Content-Type nao e confiavel num webhook: tentamos parsear e seguimos
      // com os bytes crus quando falha.
      try {
        request.body = JSON.parse(request.rawBody.toString('utf8') || '{}');
      } catch {
        request.body = {};
      }
      next();
    });

    request.on('error', () => next());
  }
}
