import type { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import type { QueueName } from './queue.names.js';

export const BULLMQ_CONNECTION = Symbol('BAAS_BULLMQ_CONNECTION');
export const QUEUE_REGISTRY = Symbol('BAAS_QUEUE_REGISTRY');

export type QueueRegistry = ReadonlyMap<QueueName, Queue>;

/** Prefixo proprio: um Redis compartilhado com o cache continua legivel. */
export const DEFAULT_BULLMQ_PREFIX = 'baas';

/**
 * O prefixo, por injecao e nao por constante.
 *
 * Duas razoes concretas: dois deploys que dividem um Redis gerenciado
 * precisam de espacos separados, e o teste de integracao roda contra um Redis
 * que no CI e compartilhado entre arquivos — com prefixo fixo, um
 * `obliterate` apagaria o trabalho de outro arquivo no meio da execucao.
 */
export const BULLMQ_PREFIX = Symbol('BAAS_BULLMQ_PREFIX');

/**
 * Conexao dedicada ao BullMQ.
 *
 * NAO reusa o token `REDIS` da API. Aquele cliente e criado com
 * `maxRetriesPerRequest: 1` e `enableOfflineQueue: false`, e o BullMQ REJEITA
 * em runtime qualquer conexao com `maxRetriesPerRequest !== null`: ele depende
 * de comandos bloqueantes que ficam pendurados por segundos por design, e o
 * retry por comando do ioredis os mataria no meio.
 *
 * Os tokens vivem aqui, e nao no modulo, porque o modulo importa a fila e a
 * fila precisa dos tokens — em um arquivo so isso e um ciclo, e o container do
 * Nest recusa.
 */
export function createBullConnection(url: string): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
  });
}
