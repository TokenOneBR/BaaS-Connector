import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import { Redis } from 'ioredis';

/**
 * Redis de verdade, numa porta livre.
 *
 * Nao e um dobro: o BullMQ depende de comandos bloqueantes, de conjuntos
 * ordenados com atraso e de scripts Lua, e um mock erraria exatamente essa
 * semantica — os testes ficariam verdes provando a implementacao do mock. E a
 * mesma razao pela qual a suite de conformidade usa um servidor HTTP real em
 * vez de interceptar `fetch`.
 *
 * Quando `REDIS_URL` ja existe (o service container do CI, ou um Redis de
 * desenvolvimento), usa esse: subir um segundo servidor so para descobrir que
 * a porta escolhida ja era do primeiro nao prova nada a mais.
 */
export class EmbeddedRedis {
  private child?: ChildProcess;
  private url?: string;

  async start(): Promise<string> {
    if (process.env.REDIS_URL) {
      this.url = process.env.REDIS_URL;
      return this.url;
    }

    const port = await freePort();
    this.child = spawn(
      'redis-server',
      [
        '--port',
        String(port),
        '--bind',
        '127.0.0.1',
        // Sem RDB e sem AOF: um `dump.rdb` no cwd do teste vira lixo no repo,
        // e o que testamos e a semantica dos comandos, nao a durabilidade em
        // disco.
        '--save',
        '',
        '--appendonly',
        'no',
      ],
      { stdio: ['ignore', 'ignore', 'ignore'] },
    );

    this.url = `redis://127.0.0.1:${port}`;
    await waitForPong(this.url);
    return this.url;
  }

  async stop(): Promise<void> {
    if (!this.child) return;
    const child = this.child;
    this.child = undefined;
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      child.kill('SIGTERM');
    });
  }
}

/** O binario existe? Localmente pode nao existir; no CI, faltar e build vermelho. */
export function hasRedisServer(): boolean {
  if (process.env.REDIS_URL) return true;
  try {
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    execSync('command -v redis-server', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForPong(url: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
    try {
      await client.connect();
      await client.ping();
      client.disconnect();
      return;
    } catch {
      client.disconnect();
      if (Date.now() > deadline) throw new Error(`redis-server nao respondeu em ${timeoutMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
