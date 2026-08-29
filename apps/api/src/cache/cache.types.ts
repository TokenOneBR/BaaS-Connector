export const CACHE_STORE = Symbol('BAAS_CACHE_STORE');

export interface CacheEntry<T> {
  value: T;
  /** Instante em que o valor foi obtido da origem, nao do cache. */
  asOf: Date;
}

/**
 * Cache com invalidacao por etiqueta.
 *
 * A invalidacao e por TAG SET (`SADD` + `SMEMBERS` + `UNLINK`), nunca por
 * `SCAN` ou `KEYS`: os dois varrem o keyspace inteiro e bloqueiam o Redis, e
 * num caminho quente como saldo isso e uma parada do servico inteiro para
 * apagar tres chaves.
 */
export interface CacheStore {
  get<T>(key: string): Promise<CacheEntry<T> | undefined>;
  set<T>(
    key: string,
    value: T,
    options: { ttlSeconds: number; asOf: Date; tags?: readonly string[] },
  ): Promise<void>;
  delete(key: string): Promise<void>;
  /** Apaga tudo que foi gravado com esta etiqueta. */
  invalidateTag(tag: string): Promise<void>;
  /**
   * Executa `fn` uma vez por chave sob concorrencia.
   *
   * Um miss de saldo em 500 requisicoes simultaneas deve virar UMA chamada ao
   * provedor. Sem isso, o primeiro pico de trafego derruba o rate limit da
   * conexao compartilhada e todos os clientes sofrem juntos.
   */
  singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

/**
 * Monta a chave.
 *
 * `{v}` e um inteiro de configuracao: incrementa-lo e a alavanca de "limpar
 * tudo" no deploy quando um formato de serializacao muda, sem precisar
 * apagar chave nenhuma.
 */
export function cacheKey(parts: {
  version: number;
  environment: string;
  entity: string;
  id: string;
  qualifier?: string;
}): string {
  const base = `baas:${parts.version}:${parts.environment}:${parts.entity}:${parts.id}`;
  return parts.qualifier ? `${base}:${parts.qualifier}` : base;
}

export function accountTag(environment: string, accountId: string): string {
  return `baas:tag:${environment}:account:${accountId}`;
}
