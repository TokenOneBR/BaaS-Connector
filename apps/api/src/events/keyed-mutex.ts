/**
 * Serializa trabalho por chave.
 *
 * Eventos do MESMO agregado precisam ser aplicados em ordem; eventos de
 * agregados diferentes podem correr juntos. Um lock global daria a ordem e
 * mataria a vazao; nenhum lock daria vazao e permitiria `pix_out.settled` ser
 * aplicado antes de `pix_out.pending`.
 *
 * E a mesma semantica de grupo do BullMQ, que e o que substitui esta classe no
 * marco do worker — por isso a logica de dominio nao muda junto.
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>();

  async runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();

    // Encadeia nos DOIS desfechos: uma tarefa que rejeita nao pode bloquear
    // para sempre as seguintes daquele agregado.
    const result = previous.then(task, task);

    // O que fica no Map e a versao que nunca rejeita, senao um rejeitado sem
    // handler derruba o processo por unhandledRejection.
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);

    try {
      return await result;
    } finally {
      // So limpa se ninguem entrou na fila depois de nos; caso contrario a
      // chave pertence a proxima tarefa.
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }

  get pendingKeys(): number {
    return this.tails.size;
  }
}
