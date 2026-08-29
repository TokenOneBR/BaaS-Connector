import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { KeyedMutex } from './keyed-mutex.js';

export const AGGREGATE_LOCK = Symbol('BAAS_AGGREGATE_LOCK');

export type LockOutcome<T> = { acquired: true; value: T } | { acquired: false };

/**
 * Serializa trabalho por agregado.
 *
 * O que este lock NAO faz: garantir correcao. Ela vem do
 * `SELECT ... FOR UPDATE` mais o guard monotonico, que ja absorvem ordem e
 * duplicata — dois eventos da mesma transacao chegando ao mesmo tempo
 * serializam no lock de linha, e `decideMonotonic` decide o desfecho certo
 * independente da ordem. O lock existe para evitar trabalho jogado fora e
 * violacao de constraint como ruido normal de log.
 *
 * Por isso quem NAO consegue o lock recebe `acquired: false` e reenfileira,
 * em vez de esperar: segurar um consumidor parado num lock e como se perde
 * vazao sem ganhar nada que o banco ja nao garanta.
 *
 * O plano original dizia "grupos do BullMQ". Grupos sao recurso do BullMQ
 * Pro, que e pago — ver ADR 0016.
 */
export interface AggregateLock {
  run<T>(key: string, task: () => Promise<T>): Promise<LockOutcome<T>>;
}

/**
 * Exclusao em processo.
 *
 * Da a MESMA garantia que a versao Redis quando ha um processo so — que e o
 * caso em teste e em desenvolvimento. Em producao com mais de um pod seria
 * falso: cada pod teria a sua propria ordem.
 */
export class KeyedMutexLock implements AggregateLock {
  private readonly mutex = new KeyedMutex();

  async run<T>(key: string, task: () => Promise<T>): Promise<LockOutcome<T>> {
    // Nunca recusa: em processo, o mutex ENFILEIRA em vez de rejeitar, e
    // esperar aqui custa microssegundos.
    return { acquired: true, value: await this.mutex.runExclusive(key, task) };
  }
}

/** TTL do lock. Alto o suficiente para uma aplicacao de evento inteira. */
const LOCK_TTL_MS = 30_000;
/** Renovacao bem antes do vencimento, para nao perder o lock em uso. */
const WATCHDOG_MS = 10_000;

/**
 * Compare-and-delete.
 *
 * `DEL` puro apagaria o lock de OUTRO dono quando o nosso ja tivesse vencido
 * — e ai duas aplicacoes do mesmo agregado rodariam juntas, que e exatamente
 * o que o lock existe para impedir.
 */
const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;

export class RedisAggregateLock implements AggregateLock {
  private readonly logger = new Logger(RedisAggregateLock.name);

  // Sem `Clock` injetado: quem conta o tempo aqui e o Redis, pelo TTL da
  // propria chave. Um relogio do processo nao teria como expirar um lock cujo
  // dono morreu.
  constructor(private readonly redis: Redis) {}

  async run<T>(key: string, task: () => Promise<T>): Promise<LockOutcome<T>> {
    const name = `baas:lock:${key}`;
    const token = randomUUID();

    let held: 'OK' | null;
    try {
      held = await this.redis.set(name, token, 'PX', LOCK_TTL_MS, 'NX');
    } catch (error) {
      // Redis fora do ar devolve `acquired: false`, e NAO `true`. Assumir que
      // o lock foi obtido porque nao deu para pedir e exatamente o modo de
      // falha que ele existe para evitar; reenfileirar custa 250 ms e a
      // correcao continua no banco.
      this.logger.warn(`Nao foi possivel pedir o lock ${key}: ${String(error)}`);
      return { acquired: false };
    }

    if (held !== 'OK') return { acquired: false };

    // Watchdog: sem ele, uma tarefa que passa do TTL perde o lock e, ao
    // terminar, apaga um lock que ja e de outro.
    const watchdog = setInterval(() => {
      void this.redis.pexpire(name, LOCK_TTL_MS).catch(() => undefined);
    }, WATCHDOG_MS);
    watchdog.unref();

    try {
      return { acquired: true, value: await task() };
    } finally {
      clearInterval(watchdog);
      await this.redis.eval(RELEASE_SCRIPT, 1, name, token).catch(() => undefined);
    }
  }
}

/**
 * Chave do agregado.
 *
 * O ambiente e obrigatorio: sem ele, um evento de homologacao bloquearia o de
 * producao que carrega o mesmo id do provedor.
 */
export function aggregateKey(environment: string, kind: string, id: string): string {
  return `${environment}:${kind}:${id}`;
}
