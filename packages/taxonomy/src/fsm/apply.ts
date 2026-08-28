import { InvalidStateTransitionError } from '../errors/baas-error.js';

import type { TransitionTable } from './transitions.js';

export interface TransitionCheck<S extends string> {
  allowed: boolean;
  /** True quando origem e destino sao iguais: no-op idempotente, nao erro. */
  noop: boolean;
  from: S;
  to: S;
}

export function checkTransition<S extends string>(
  table: TransitionTable<S>,
  from: S,
  to: S,
): TransitionCheck<S> {
  if (from === to) return { allowed: true, noop: true, from, to };
  return { allowed: (table[from] ?? []).includes(to), noop: false, from, to };
}

/**
 * Aplica uma transicao ou lanca.
 *
 * Usado tanto pela camada de API quanto pela ingestao de webhooks, para que
 * so exista um lugar decidindo o que e legal.
 */
export function applyTransition<S extends string>(
  entity: string,
  table: TransitionTable<S>,
  from: S,
  to: S,
): S {
  const check = checkTransition(table, from, to);
  if (!check.allowed) {
    throw new InvalidStateTransitionError(entity, from, to);
  }
  return to;
}

export function isTerminal<S extends string>(table: TransitionTable<S>, status: S): boolean {
  return (table[status] ?? []).length === 0;
}

/**
 * Rank monotonico de um estado.
 *
 * A ingestao de webhooks nunca sobrescreve estado cegamente: aplica so quando
 * o rank do evento novo e maior que o atual. Provedores entregam eventos fora
 * de ordem e duplicados, e absorver isso no rank e o que impede que um evento
 * atrasado de "pendente" desfaca uma liquidacao ja registrada.
 *
 * Os ranks sao declarados explicitamente, nao derivados do grafo: as tabelas
 * de transicao tem ciclos legitimos (UNKNOWN reentra em PENDING, uma pendencia
 * de onboarding pode reabrir), e "maior profundidade a partir do inicial" da
 * respostas erradas nesses casos. Rank e uma decisao semantica sobre o que
 * significa "mais adiantado", nao uma propriedade topologica.
 */
export type RankTable<S extends string> = Readonly<Record<S, number>>;

/**
 * Verifica que todo estado da tabela de transicao tem rank declarado.
 * Chamado por teste, para um estado novo no enum nunca ficar sem rank.
 */
export function assertRanksCoverTable<S extends string>(
  table: TransitionTable<S>,
  ranks: RankTable<S>,
): void {
  const missing = (Object.keys(table) as S[]).filter((state) => ranks[state] === undefined);
  if (missing.length > 0) {
    throw new Error(`Estados sem rank monotonico declarado: ${missing.join(', ')}`);
  }
}

export interface MonotonicApplyInput<S extends string> {
  current: S;
  incoming: S;
  ranks: RankTable<S>;
  /** Instante do evento no provedor. */
  occurredAt: Date;
  /** Instante do ultimo evento ja aplicado a esta entidade. */
  lastEventAt?: Date | null;
}

export type MonotonicDecision =
  { apply: true } | { apply: false; reason: 'stale_rank' | 'stale_timestamp' | 'same_state' };

/**
 * Decide se um evento de provedor deve ser aplicado.
 *
 * Retornar `apply: false` nao e erro: o evento recebe ack e e marcado como
 * descartado. Reentregar e re-ordenar sao comportamento normal do provedor.
 */
export function decideMonotonic<S extends string>(
  input: MonotonicApplyInput<S>,
): MonotonicDecision {
  const { current, incoming, ranks, occurredAt, lastEventAt } = input;

  if (lastEventAt && occurredAt.getTime() < lastEventAt.getTime()) {
    return { apply: false, reason: 'stale_timestamp' };
  }
  if (current === incoming) {
    return { apply: false, reason: 'same_state' };
  }
  if ((ranks[incoming] ?? 0) <= (ranks[current] ?? 0)) {
    return { apply: false, reason: 'stale_rank' };
  }
  return { apply: true };
}
