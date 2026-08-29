/**
 * Casa o tipo do evento contra os filtros do endpoint.
 *
 * Lista vazia significa TODOS, por contrato de `zCreateWebhookEndpoint`.
 *
 * NAO usa `new RegExp(filtroArmazenado)`: regex compilada a partir de string
 * gravada por um cliente e superficie de ReDoS, num caminho que roda por
 * evento e por endpoint. As tres formas aceitas — exato, `recurso.*` e `*` —
 * sao decidiveis com comparacao de string.
 */
export function matchesEventType(filters: readonly string[], type: string): boolean {
  if (filters.length === 0) return true;

  return filters.some((filter) => {
    if (filter === '*') return true;
    if (filter.endsWith('.*')) return type.startsWith(filter.slice(0, -1));
    return filter === type;
  });
}
