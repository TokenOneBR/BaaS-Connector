import { describe, expect, it } from 'vitest';

import { QUEUE, QUEUE_FOR_KIND, QUEUE_POLICY, jobIdOf } from './queue.names.js';

describe('roteamento de fila', () => {
  it('todo tipo de job tem fila', () => {
    // Um `kind` novo sem fila so falharia em runtime, no primeiro enqueue.
    for (const queue of Object.values(QUEUE_FOR_KIND)) {
      expect(Object.values(QUEUE)).toContain(queue);
    }
  });

  it('toda fila tem politica', () => {
    for (const name of Object.values(QUEUE)) {
      expect(QUEUE_POLICY[name]).toBeDefined();
    }
  });

  it('as filas de escada nao retentam pelo BullMQ', () => {
    // A escada vive no Postgres e a fila e so o despertador. Retry do BullMQ
    // por cima duplicaria a escada e entregaria duas vezes no mesmo degrau.
    expect(QUEUE_POLICY[QUEUE.outboxDispatch].attempts).toBe(1);
    expect(QUEUE_POLICY[QUEUE.operationResolve].attempts).toBe(1);
  });

  it('nenhuma chave de job contem dois-pontos', () => {
    // O BullMQ RECUSA `:` em id customizado: e o separador das chaves dele no
    // Redis. Descoberto contra um Redis de verdade, nao contra um dobro.
    const chaves = [
      jobIdOf({ kind: 'inbound_webhook', eventId: 'evt_1' }),
      jobIdOf({ kind: 'outbox_dispatch', environment: 'HOMOLOGACAO' as never, deliveryId: 'd_1' }),
      jobIdOf({
        kind: 'operation_resolve',
        environment: 'HOMOLOGACAO' as never,
        operationId: 'opr_1',
        step: 2,
      }),
      jobIdOf({ kind: 'reconciliation', environment: 'HOMOLOGACAO' as never, runId: 'rec_1' }),
      jobIdOf({ kind: 'poll', connectionId: 'con_1', stream: 'statement' }),
    ];

    for (const chave of chaves) expect(chave).not.toContain(':');
  });

  it('degraus diferentes produzem chaves diferentes', () => {
    const passo0 = jobIdOf({
      kind: 'operation_resolve',
      environment: 'HOMOLOGACAO' as never,
      operationId: 'opr_1',
      step: 0,
    });
    const passo1 = jobIdOf({
      kind: 'operation_resolve',
      environment: 'HOMOLOGACAO' as never,
      operationId: 'opr_1',
      step: 1,
    });
    expect(passo0).not.toBe(passo1);
  });
});
