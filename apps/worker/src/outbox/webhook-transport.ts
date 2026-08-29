import type { Readable } from 'node:stream';

import { Injectable } from '@nestjs/common';
import { request } from 'undici';

export type TransportResult =
  | { kind: 'response'; status: number; retryAfterSeconds?: number; bodySnippet?: string; durationMs: number }
  | { kind: 'network'; error: string; durationMs: number };

/** Primeiros 2 KB da resposta. Corpo ilimitado de terceiro e DoS de memoria. */
const SNIPPET_BYTES = 2_048;
const HEADERS_TIMEOUT_MS = 5_000;
const BODY_TIMEOUT_MS = 10_000;

@Injectable()
export class WebhookTransport {
  /**
   * POST para o endpoint do cliente.
   *
   * `undici` e nao `fetch` porque precisamos limitar a leitura do CORPO, e o
   * `fetch` nao expoe `bodyTimeout`. Um endpoint que aceita a conexao e nunca
   * fecha o corpo seguraria o consumidor indefinidamente.
   *
   * `maxRedirections: 0` de proposito: seguir um redirect mandaria um payload
   * assinado, com dado de pagamento, para um host escolhido por quem
   * respondeu.
   */
  async post(
    url: string,
    body: string,
    headers: Record<string, string>,
    /** Instante de referencia para `Retry-After` em forma de data HTTP. */
    now: Date,
  ): Promise<TransportResult> {
    const started = process.hrtime.bigint();
    const elapsed = () => Number(process.hrtime.bigint() - started) / 1e6;

    try {
      const response = await request(url, {
        method: 'POST',
        body,
        headers,
        headersTimeout: HEADERS_TIMEOUT_MS,
        bodyTimeout: BODY_TIMEOUT_MS,
        // `maxRedirections` fica no default (0) de proposito e nao e passado:
        // o `undici.request` so segue redirect com o interceptor ligado, e nao
        // liga-lo e o que garante que um `Location` de terceiro nunca recebe o
        // payload assinado.
      });

      const snippet = await readSnippet(response.body);
      return {
        kind: 'response',
        status: response.statusCode,
        retryAfterSeconds: parseRetryAfter(response.headers['retry-after'], now),
        bodySnippet: snippet,
        durationMs: Math.round(elapsed()),
      };
    } catch (error) {
      return {
        kind: 'network',
        error: error instanceof Error ? error.message : String(error),
        durationMs: Math.round(elapsed()),
      };
    }
  }
}

async function readSnippet(body: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of body) {
    const buffer = Buffer.from(chunk as Buffer);
    chunks.push(buffer);
    total += buffer.length;
    // Corta e ABANDONA o stream: continuar lendo um corpo que nao termina e
    // exatamente o que o limite existe para impedir.
    if (total >= SNIPPET_BYTES) {
      body.destroy();
      break;
    }
  }

  return Buffer.concat(chunks).subarray(0, SNIPPET_BYTES).toString('utf8');
}

/** `Retry-After` em segundos. A forma com data HTTP tambem e aceita. */
function parseRetryAfter(
  value: string | string[] | undefined,
  now: Date,
): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds);

  const at = Date.parse(raw);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.round((at - now.getTime()) / 1000));
}
