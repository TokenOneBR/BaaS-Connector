import { describe, expect, it } from 'vitest';

import { KeyedMutex } from './keyed-mutex.js';

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('KeyedMutex', () => {
  it('serializa a mesma chave na ordem de chegada', async () => {
    const mutex = new KeyedMutex();
    const order: string[] = [];

    const first = mutex.runExclusive('acc_1', async () => {
      await tick(20);
      order.push('primeiro');
    });
    const second = mutex.runExclusive('acc_1', async () => {
      order.push('segundo');
    });

    await Promise.all([first, second]);

    // Sem a serializacao, 'segundo' terminaria antes e um pix_out.settled
    // seria aplicado antes do pix_out.pending do mesmo agregado.
    expect(order).toEqual(['primeiro', 'segundo']);
  });

  it('deixa chaves diferentes correrem em paralelo', async () => {
    const mutex = new KeyedMutex();
    const order: string[] = [];

    await Promise.all([
      mutex.runExclusive('acc_1', async () => {
        await tick(20);
        order.push('lento');
      }),
      mutex.runExclusive('acc_2', async () => {
        order.push('rapido');
      }),
    ]);

    // Um lock global daria ordem e mataria a vazao: aqui o rapido nao espera.
    expect(order).toEqual(['rapido', 'lento']);
  });

  it('uma tarefa que falha nao trava as seguintes da mesma chave', async () => {
    const mutex = new KeyedMutex();

    await expect(
      mutex.runExclusive('acc_1', async () => {
        throw new Error('falha proposital');
      }),
    ).rejects.toThrow('falha proposital');

    await expect(mutex.runExclusive('acc_1', async () => 'ok')).resolves.toBe('ok');
  });

  it('libera a chave quando ninguem mais espera', async () => {
    const mutex = new KeyedMutex();
    await mutex.runExclusive('acc_1', async () => undefined);

    // Num processo de vida longa, nao liberar faria o Map crescer uma entrada
    // por conta ja vista e nunca encolher.
    expect(mutex.pendingKeys).toBe(0);
  });

  it('nao derruba o processo com rejeicao sem handler', async () => {
    const mutex = new KeyedMutex();

    // A primeira rejeita e ninguem faz await nela imediatamente.
    const ignored = mutex.runExclusive('acc_1', async () => {
      throw new Error('ignorada');
    });
    ignored.catch(() => undefined);

    await expect(mutex.runExclusive('acc_1', async () => 'seguinte')).resolves.toBe('seguinte');
  });
});
