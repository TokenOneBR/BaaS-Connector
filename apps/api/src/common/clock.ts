import { systemClock, type Clock } from '@baasconn/taxonomy';

/**
 * Relogio, injetado.
 *
 * Nao e purismo: lease de idempotencia, janela de assinatura e TTL de cache
 * sao logica temporal com consequencia de dinheiro, e testa-los com `Date.now()`
 * exigiria `sleep` — que deixa a suite lenta e intermitente, os dois motivos
 * pelos quais um teste de tempo acaba sendo deletado em vez de consertado.
 */
export const CLOCK = Symbol('BAAS_CLOCK');

export const clockProvider = { provide: CLOCK, useValue: systemClock };

export type { Clock };
