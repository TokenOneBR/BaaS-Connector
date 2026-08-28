/**
 * Como um provedor especifico aceita chave de idempotencia.
 *
 * A chave que enviamos e derivada do NOSSO `operationId`, nunca da
 * `Idempotency-Key` do cliente. Tres motivos:
 *
 * 1. Chave de cliente e string arbitraria; varios provedores exigem UUID.
 * 2. As vezes precisamos de uma segunda chamada ao provedor para a mesma
 *    chave do cliente (devolucao parcial), e o mapeamento precisa ser
 *    um-para-um com a nossa operacao.
 * 3. Isola o namespace: a chave do cliente e nossa, a do provedor e do
 *    provedor.
 */
export type ProviderIdempotency =
  | { mode: 'header'; header: string; format?: (operationId: string) => string }
  | { mode: 'body_field'; path: string; format?: (operationId: string) => string }
  /** Dedupe nativo do PIX: nos cunhamos o EndToEndId. */
  | { mode: 'end_to_end_id' }
  /** O provedor deduplica pelo nosso externalId do recurso. */
  | { mode: 'external_id' }
  /**
   * O provedor NAO tem mecanismo de idempotencia.
   *
   * Nesse caso o adapter precisa implementar `findByIdempotencyKey`, e o kit
   * recusa retentar qualquer escrita automaticamente.
   */
  | { mode: 'none' };

export function resolveProviderKey(
  spec: ProviderIdempotency,
  operationId: string,
): string | undefined {
  switch (spec.mode) {
    case 'header':
    case 'body_field':
      return spec.format ? spec.format(operationId) : operationId;
    default:
      return undefined;
  }
}
