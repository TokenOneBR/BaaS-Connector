import { z } from 'zod';

/**
 * Paginacao por cursor, sempre.
 *
 * Offset sobre uma tabela que recebe insert constante produz duplicatas e
 * buracos. Num extrato financeiro isso e bug de correcao, nao inconveniencia.
 */
export const zPaginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(2048).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export type PaginationQuery = z.infer<typeof zPaginationQuery>;

export const zPageInfo = z.object({
  has_more: z.boolean(),
  next_cursor: z.string().nullable(),
  prev_cursor: z.string().nullable(),
  limit: z.number().int(),
});

/**
 * Frescor do dado devolvido.
 *
 * Obrigatorio em toda leitura cacheavel. O padrao do saldo e servir do cache,
 * e isso so e seguro porque o cliente sempre sabe a idade do numero que
 * recebeu e pode pedir `consistency=strong` quando for decidir algo com ele.
 */
export const zFreshness = z.object({
  source: z.enum(['cache', 'provider', 'ledger', 'cache-stale']),
  as_of: z.string(),
  age_ms: z.number().int().nonnegative(),
  stale_after: z.string().optional(),
  degraded: z.boolean().optional(),
});

export type Freshness = z.infer<typeof zFreshness>;

export const zResponseMeta = z.object({
  request_id: z.string(),
  freshness: zFreshness.optional(),
  capability_notes: z.array(z.string()).optional(),
});

/** Envelope de lista. Sem `total`: contar sobre dado de provedor e caro ou impossivel. */
export function zListResponse<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    object: z.literal('list'),
    data: z.array(item),
    page: zPageInfo,
    _meta: zResponseMeta.optional(),
  });
}

/** Envelope de recurso unico. */
export function zResourceResponse<T extends z.ZodRawShape>(shape: T) {
  return z.object({ ...shape, _meta: zResponseMeta.optional() });
}

export const zConsistency = z.enum(['cached', 'strong']).default('cached');
