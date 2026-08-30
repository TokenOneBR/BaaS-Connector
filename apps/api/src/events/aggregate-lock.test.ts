import { describe, expect, it, vi } from 'vitest';

import { KeyedMutexLock, RedisAggregateLock, aggregateKey } from './aggregate-lock.js';

/** Dobro de Redis com so o que o lock usa. */
function fakeRedis(overrides: Partial<Record<string, unknown>> = {}) {
  const store = new Map<string, string>();
  return {
    store,
    set: vi.fn(async (key: string, value: string, _px: string, _ttl: number, _nx: string) => {
      if (store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
    pexpire: vi.fn(async () => 1),
    eval: vi.fn(async (_script: string, _n: number, key: string, token: string) => {
      if (store.get(key) === token) {
        store.delete(key);
        return 1;
      }
      return 0;
    }),
    ...overrides,
  } as never;
}

describe('lock por agregado', () => {
  it('a chave carrega o ambiente', () => {
    // Sem o ambiente, um evento de homologacao bloquearia o de producao que
    // carrega o mesmo id do provedor.
    expect(aggregateKey('HOMOLOGACAO', 'transaction', 'mb-1')).toBe('HOMOLOGACAO:transaction:mb-1');
    expect(aggregateKey('PRODUCAO', 'transaction', 'mb-1')).not.toBe(
      aggregateKey('HOMOLOGACAO', 'transaction', 'mb-1'),
    );
  });

  it('em memoria, enfileira em vez de recusar', async () => {
    const lock = new KeyedMutexLock();
    const ordem: string[] = [];

    await Promise.all([
      lock.run('a', async () => {
        ordem.push('inicio-1');
        await new Promise((resolve) => setTimeout(resolve, 5));
        ordem.push('fim-1');
      }),
      lock.run('a', async () => {
        ordem.push('inicio-2');
      }),
    ]);

    // Um processo so: esperar custa microssegundos, entao serializar e melhor
    // do que reenfileirar.
    expect(ordem).toEqual(['inicio-1', 'fim-1', 'inicio-2']);
  });

  it('no Redis, quem perde o lock NAO espera', async () => {
    const redis = fakeRedis();
    const lock = new RedisAggregateLock(redis);

    let liberar!: () => void;
    const primeira = lock.run('a', () => new Promise<void>((resolve) => (liberar = resolve)));

    const segunda = await lock.run('a', async () => 'nao deveria rodar');
    // Segurar um consumidor parado num lock e como se perde vazao sem ganhar
    // nada que o banco ja nao garanta.
    expect(segunda).toEqual({ acquired: false });

    liberar();
    await expect(primeira).resolves.toEqual({ acquired: true, value: undefined });
  });

  it('libera o lock depois de terminar', async () => {
    const redis = fakeRedis();
    const lock = new RedisAggregateLock(redis);

    await lock.run('a', async () => 'ok');
    await expect(lock.run('a', async () => 'segunda vez')).resolves.toEqual({
      acquired: true,
      value: 'segunda vez',
    });
  });

  it('libera o lock mesmo quando a tarefa lanca', async () => {
    const redis = fakeRedis();
    const lock = new RedisAggregateLock(redis);

    await expect(
      lock.run('a', async () => {
        throw new Error('falhou');
      }),
    ).rejects.toThrow('falhou');

    // Sem o `finally`, uma tarefa que lanca travaria o agregado ate o TTL.
    await expect(lock.run('a', async () => 'depois')).resolves.toMatchObject({ acquired: true });
  });

  it('libera com compare-and-delete, nunca DEL cru', async () => {
    const redis = fakeRedis();
    const lock = new RedisAggregateLock(redis);
    await lock.run('a', async () => 'ok');

    // `DEL` puro apagaria o lock de OUTRO dono quando o nosso ja tivesse
    // vencido, e duas aplicacoes do mesmo agregado rodariam juntas.
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('GET', KEYS[1]) == ARGV[1]"),
      1,
      'baas:lock:a',
      expect.any(String),
    );
  });

  it('Redis fora do ar recusa o lock, nao concede', async () => {
    const redis = fakeRedis({
      set: vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    });
    const lock = new RedisAggregateLock(redis);

    // Assumir que o lock foi obtido porque nao deu para pedir e exatamente o
    // modo de falha que ele existe para evitar.
    await expect(lock.run('a', async () => 'nao deveria rodar')).resolves.toEqual({
      acquired: false,
    });
  });
});
