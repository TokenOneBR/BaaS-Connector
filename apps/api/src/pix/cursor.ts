import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Cursor de keyset do extrato.
 *
 * Carrega o par `(data, id)` que o `ORDER BY` usa, mais o digest dos filtros
 * da consulta. O digest existe porque paginar com filtros diferentes dos da
 * primeira pagina produz um resultado que nao e nem uma consulta nem a outra —
 * e num extrato financeiro isso e um erro silencioso de conteudo.
 *
 * A assinatura HMAC nao esconde nada (o conteudo e base64, nao criptografia):
 * ela detecta adulteracao, para um cliente nao conseguir pular para um id
 * arbitrario nem forjar um digest de filtro.
 */
export interface KeysetCursor {
  /** `YYYY-MM-DD` da coluna `effective_date`. */
  date: string;
  id: string;
  /** sha256 dos filtros, para detectar troca de filtro no meio da paginacao. */
  filters: string;
}

export function encodeCursor(cursor: KeysetCursor, secret: string): string {
  const payload = Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export type CursorFailure = 'malformed' | 'bad_signature' | 'filters_changed';

export function decodeCursor(
  value: string,
  secret: string,
  filters: string,
): { ok: true; cursor: KeysetCursor } | { ok: false; reason: CursorFailure } {
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return { ok: false, reason: 'malformed' };

  const expected = Buffer.from(sign(payload, secret), 'utf8');
  const received = Buffer.from(signature, 'utf8');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (!isCursor(parsed)) return { ok: false, reason: 'malformed' };
  // Depois da assinatura: um digest diferente aqui e um cliente que mudou o
  // filtro entre paginas, nao alguem forjando cursor.
  if (parsed.filters !== filters) return { ok: false, reason: 'filters_changed' };

  return { ok: true, cursor: parsed };
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function isCursor(value: unknown): value is KeysetCursor {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.date === 'string' &&
    typeof candidate.id === 'string' &&
    typeof candidate.filters === 'string'
  );
}
