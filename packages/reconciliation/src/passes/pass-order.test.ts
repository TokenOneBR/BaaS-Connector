import { MatchConfidence, ReconciliationSide } from '@baasconn/taxonomy';
import { describe, expect, it } from 'vitest';

import { reconcile } from '../engine.js';
import { input, item, policy } from '../test-support.js';
import type { BreakDraft, MatchLink, NormalizedItem } from '../types.js';

import { passDeterministicFuzzy } from './deterministic-fuzzy.js';
import { passStrong } from './strong.js';

/**
 * A ordem dos passes 1 e 2 e uma REGRA, e este arquivo existe para provar
 * isso — nao para descrever o comportamento atual.
 *
 * O cenario e cruzado de proposito: por E2EID, P1 e de C1; por proximidade de
 * instante, P1 esta mais perto de C2. Os dois passes veem o MESMO balde e
 * chegam a conclusoes opostas, e so um deles tem como estar certo.
 */
const P1 = () =>
  item({
    id: 'pit_1',
    side: ReconciliationSide.PROVIDER,
    endToEndId: 'E1801234520260310100011111111',
    postedAt: '2026-03-10T10:00:00.000Z',
  });
const P2 = () =>
  item({
    id: 'pit_2',
    side: ReconciliationSide.PROVIDER,
    endToEndId: 'E1801234520260310110022222222',
    postedAt: '2026-03-10T11:00:00.000Z',
  });
const C1 = () =>
  item({
    id: 'txn_1',
    side: ReconciliationSide.LOCAL,
    endToEndId: 'E1801234520260310100011111111',
    postedAt: '2026-03-10T11:05:00.000Z',
  });
const C2 = () =>
  item({
    id: 'txn_2',
    side: ReconciliationSide.LOCAL,
    endToEndId: 'E1801234520260310110022222222',
    postedAt: '2026-03-10T10:05:00.000Z',
  });

function stateOf(provider: NormalizedItem[], local: NormalizedItem[]) {
  return {
    provider: new Map(provider.map((i) => [i.id, i])),
    local: new Map(local.map((i) => [i.id, i])),
    matches: [] as MatchLink[],
    breaks: [] as BreakDraft[],
    policy: policy(),
  };
}

function pares(matches: readonly MatchLink[]): string[] {
  return matches.map((m) => `${m.providerItemId}->${m.localItemId}`).sort();
}

describe('ordem dos passes', () => {
  it('a chave forte casa por E2EID mesmo com o instante apontando para o outro', () => {
    const resultado = reconcile(input({ provider: [P1(), P2()], local: [C1(), C2()] }));

    expect(pares(resultado.matches)).toEqual(['pit_1->txn_1', 'pit_2->txn_2']);
    for (const match of resultado.matches) {
      expect(match.confidence).toBe(MatchConfidence.EXACT);
      expect(match.pass).toBe(1);
      expect(match.needsReview).toBe(false);
    }
  });

  it('invertida, a ordem produz DOIS pares errados com confianca alta', () => {
    // Nao e hipotese: e o passe 2 rodando primeiro sobre o mesmo balde.
    const invertido = stateOf([P1(), P2()], [C1(), C2()]);
    passDeterministicFuzzy(invertido);
    passStrong(invertido);

    expect(pares(invertido.matches)).toEqual(['pit_1->txn_2', 'pit_2->txn_1']);
    expect(invertido.matches.every((m) => m.confidence === MatchConfidence.HIGH)).toBe(true);
    expect(invertido.matches.every((m) => m.pass === 2)).toBe(true);
  });

  it('o passe fuzzy nao rouba item que a chave forte ja consumiu', () => {
    const correto = stateOf([P1(), P2()], [C1(), C2()]);
    passStrong(correto);
    expect(correto.provider.size).toBe(0);
    expect(correto.local.size).toBe(0);

    passDeterministicFuzzy(correto);
    expect(correto.matches).toHaveLength(2);
  });
});
