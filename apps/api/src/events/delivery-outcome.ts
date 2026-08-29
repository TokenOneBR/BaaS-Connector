/** O que fazer depois de uma tentativa de entrega. */
export type DeliveryDecision =
  | { kind: 'succeeded' }
  /** Reagenda no proximo degrau. `retryAfterSeconds` vence a escada se maior. */
  | { kind: 'retry'; reason: string; retryAfterSeconds?: number }
  /** Terminal para esta entrega, sem desabilitar o endpoint. */
  | { kind: 'exhausted'; reason: string }
  /** Terminal para o endpoint INTEIRO. */
  | { kind: 'disable_endpoint'; reason: string };

export interface DeliveryResponse {
  status: number;
  retryAfterSeconds?: number;
}

/**
 * Decide o desfecho de uma resposta.
 *
 * Funcao pura, separada do transporte, porque e a tabela de decisao que mais
 * importa e a que mais precisa de teste — cada linha aqui fecha um modo de
 * falha diferente.
 */
export function decideDelivery(response: DeliveryResponse): DeliveryDecision {
  const { status } = response;

  if (status >= 200 && status < 300) return { kind: 'succeeded' };

  // 410 Gone e o UNICO 4xx terminal. E literalmente o que o codigo pede:
  // continuar batendo depois dele e ignorar o que o cliente disse.
  if (status === 410) {
    return { kind: 'disable_endpoint', reason: 'HTTP 410 Gone' };
  }

  // 3xx NAO e seguido. Redirect para host de terceiro transforma um payload
  // assinado, com dado de pagamento, em vazamento — e o `Location` vem de
  // fora.
  if (status >= 300 && status < 400) {
    return { kind: 'retry', reason: `HTTP ${status}: redirect nao e seguido` };
  }

  if (status === 429 || status === 503) {
    return {
      kind: 'retry',
      reason: `HTTP ${status}`,
      // Quem pede pausa maior conhece a propria capacidade melhor que a nossa
      // escada. Menor do que a escada e ignorado: nao vamos acelerar por
      // pedido de terceiro.
      retryAfterSeconds: response.retryAfterSeconds,
    };
  }

  // Os demais 4xx RETENTAM. Um 401 quase sempre e segredo rotacionado do lado
  // do cliente, e um 404 e rota que ainda vai subir num deploy: quem conserta
  // dentro de 72h recebe o evento. Desistir no primeiro 4xx perderia evento
  // por causa de um erro que nao e nosso nem permanente.
  return { kind: 'retry', reason: `HTTP ${status}` };
}

/**
 * Instante da proxima tentativa.
 *
 * Jitter de +/-20% para nao sincronizar N entregas que falharam juntas — sem
 * ele, uma queda de 30 segundos do cliente vira uma rajada exatamente no
 * mesmo milissegundo, e a segunda queda e culpa nossa.
 */
export function nextAttemptAt(input: {
  attempt: number;
  schedule: readonly number[];
  retryAfterSeconds?: number;
  now: Date;
  random?: () => number;
}): Date | undefined {
  const base = input.schedule[input.attempt - 1];
  if (base === undefined) return undefined;

  const random = input.random ?? Math.random;
  const jittered = Math.round(base * (0.8 + random() * 0.4));
  const seconds = Math.max(jittered, input.retryAfterSeconds ?? 0);
  return new Date(input.now.getTime() + seconds * 1000);
}
