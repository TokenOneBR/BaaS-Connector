import type { MoneyJSON, PersonTypeLike } from './types.js';

export interface Pagination {
  limit: number;
  cursor?: string;
}

export interface Page<T> {
  data: T[];
  nextCursor?: string;
  hasMore: boolean;
}

/**
 * Referencia a uma conta no provedor.
 *
 * Adapters nunca veem nossos identificadores internos: recebem apenas o id
 * do proprio provedor. Isso mantem o adapter portavel e testavel sem banco.
 */
export interface AccountRef {
  providerAccountId: string;
  /** Alguns provedores chaveiam por coordenadas bancarias em vez de id. */
  branch?: string;
  number?: string;
}

export interface HealthReport {
  healthy: boolean;
  latencyMs?: number;
  message?: string;
  checkedAt: string;
}

export type { MoneyJSON, PersonTypeLike };
