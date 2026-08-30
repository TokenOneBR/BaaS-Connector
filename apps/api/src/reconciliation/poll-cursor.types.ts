export const POLL_CURSOR_REPOSITORY = Symbol('BAAS_POLL_CURSOR_REPOSITORY');

export interface PollCursorRecord {
  id: string;
  connectionId: string;
  stream: string;
  /**
   * NUNCA nulo, apesar de a coluna aceitar.
   *
   * `@@unique([connectionId, stream, scopeId])` com `scopeId` nullable tem o
   * mesmo defeito da dedup de quebra: em Postgres NULL nao e igual a NULL num
   * indice unico, entao dois cursores de escopo nulo escapariam da restricao e
   * o poller passaria a ter duas marcas d'agua concorrentes para a mesma
   * origem — cada uma andando por cima da outra.
   */
  scopeId: string;
  cursor?: string;
  watermark: Date;
  lapSeconds: number;
  lastRunAt?: Date;
}

export interface PollCursorRepository {
  /** Le, ou cria com a marca d'agua inicial dada. */
  ensure(input: {
    id: string;
    connectionId: string;
    stream: string;
    scopeId: string;
    watermark: Date;
    lapSeconds: number;
  }): Promise<PollCursorRecord>;
  /**
   * Avanca a marca d'agua.
   *
   * So e chamado depois de a pagina INTEIRA aplicar sem lancar. Avancar por
   * cima de um erro e como um poller pula um dia em silencio: nada falha,
   * nada alerta, e o movimento daquele dia simplesmente nunca chega.
   */
  advance(input: { id: string; watermark: Date; cursor?: string; at: Date }): Promise<void>;
  recordFailure(id: string, error: Record<string, unknown>, at: Date): Promise<void>;
  listByStream(stream: string): Promise<PollCursorRecord[]>;
}
