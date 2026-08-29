import { BreakSeverity, BreakType, MatchConfidence, ReconciliationSide } from '@baasconn/taxonomy';

import { dedupeKeyFor } from '../match-key.js';
import type { NormalizedItem } from '../types.js';

import type { PassState } from './strong.js';

/**
 * Passe 2 — fuzzy deterministico.
 *
 * Balde por `sha256(conta|sentido|valor|data)`, que o schema ja preve e
 * indexa. Dentro do balde tudo tem o MESMO valor e a MESMA data, entao o unico
 * sinal que resta para parear e o instante.
 *
 * Roda DEPOIS da chave forte, e nao ao contrario: aqui o pareamento e
 * inferido, e inferir por cima de uma ligacao certa e trocar certeza por
 * palpite.
 */
export function passDeterministicFuzzy(state: PassState): void {
  const baldes = agrupar(state);

  // Ordem lexicografica do balde: duas execucoes da mesma janela precisam
  // produzir o MESMO conjunto de casamentos. Um painel cujas quebras oscilam
  // perde a confianca do operador antes de perder dinheiro.
  for (const chave of [...baldes.keys()].sort()) {
    const balde = baldes.get(chave)!;
    const provedor = ordenar(balde.provider);
    const local = ordenar(balde.local);
    if (provedor.length === 0 || local.length === 0) continue;

    const ambiguo = provedor.length > 1 || local.length > 1;
    if (ambiguo && Math.max(provedor.length, local.length) > state.policy.maxGreedyPairs) {
      // Balde grande demais: nao adivinhamos. Segue para o passe 3, que casa
      // um a um com confianca baixa e marca para revisao.
      continue;
    }

    const pares = casarGuloso(provedor, local);
    for (const [p, c] of pares) {
      state.provider.delete(p.id);
      state.local.delete(c.id);
      state.matches.push({
        providerItemId: p.id,
        localItemId: c.id,
        confidence: MatchConfidence.HIGH,
        pass: 2,
        // Balde 1:1 nao tem o que revisar: valor, data, conta e sentido batem
        // e nao havia outro candidato. n:m foi decidido por proximidade de
        // instante, que e heuristica — e heuristica sobre dinheiro se declara.
        needsReview: ambiguo,
      });
    }

    duplicatasSobrando(state, pares, provedor, local);
  }
}

interface Balde {
  provider: NormalizedItem[];
  local: NormalizedItem[];
}

function agrupar(state: PassState): Map<string, Balde> {
  const baldes = new Map<string, Balde>();
  const push = (item: NormalizedItem, lado: 'provider' | 'local'): void => {
    const balde = baldes.get(item.matchKeyFuzzy) ?? { provider: [], local: [] };
    balde[lado].push(item);
    baldes.set(item.matchKeyFuzzy, balde);
  };
  for (const item of state.provider.values()) push(item, 'provider');
  for (const item of state.local.values()) push(item, 'local');
  return baldes;
}

function ordenar(items: NormalizedItem[]): NormalizedItem[] {
  return [...items].sort(
    (a, b) => a.postedAt.getTime() - b.postedAt.getTime() || a.id.localeCompare(b.id),
  );
}

/**
 * Guloso por instante mais proximo, desempatado por id.
 *
 * O desempate lexicografico nao e detalhe: sem ele, dois candidatos
 * equidistantes sao escolhidos pela ordem em que o Postgres devolveu as
 * linhas, e a mesma janela conciliada duas vezes produz casamentos
 * diferentes.
 */
function casarGuloso(
  provedor: readonly NormalizedItem[],
  local: readonly NormalizedItem[],
): Array<[NormalizedItem, NormalizedItem]> {
  const candidatos: Array<{ p: NormalizedItem; c: NormalizedItem; delta: number }> = [];
  for (const p of provedor) {
    for (const c of local) {
      candidatos.push({ p, c, delta: Math.abs(p.postedAt.getTime() - c.postedAt.getTime()) });
    }
  }
  candidatos.sort(
    (a, b) => a.delta - b.delta || a.p.id.localeCompare(b.p.id) || a.c.id.localeCompare(b.c.id),
  );

  const usadosP = new Set<string>();
  const usadosC = new Set<string>();
  const pares: Array<[NormalizedItem, NormalizedItem]> = [];
  for (const { p, c } of candidatos) {
    if (usadosP.has(p.id) || usadosC.has(c.id)) continue;
    usadosP.add(p.id);
    usadosC.add(c.id);
    pares.push([p, c]);
  }
  return pares;
}

/**
 * Sobra de um lado com contraparte identica a um item ja casado e duplicata.
 *
 * A guarda importa: dois pagamentos genuinos de R$ 10 para a mesma contraparte
 * no mesmo dia existem. O que NAO existe e o provedor ter um e nos termos
 * dois, com a mesma contraparte — ai um dos nossos foi gravado duas vezes.
 * Por isso a regra so vale para o excedente do lado que tem mais itens.
 */
function duplicatasSobrando(
  state: PassState,
  pares: ReadonlyArray<[NormalizedItem, NormalizedItem]>,
  provedor: readonly NormalizedItem[],
  local: readonly NormalizedItem[],
): void {
  const casadosP = new Map(pares.map(([p]) => [p.id, p]));
  const casadosC = new Map(pares.map(([, c]) => [c.id, c]));

  const lados: Array<{
    sobras: NormalizedItem[];
    casados: NormalizedItem[];
    tipo: BreakType;
    lado: ReconciliationSide;
  }> = [
    {
      sobras: local.filter((item) => !casadosC.has(item.id)),
      casados: [...casadosC.values()],
      tipo: BreakType.DUPLICATE_LOCAL,
      lado: ReconciliationSide.LOCAL,
    },
    {
      sobras: provedor.filter((item) => !casadosP.has(item.id)),
      casados: [...casadosP.values()],
      tipo: BreakType.DUPLICATE_PROVIDER,
      lado: ReconciliationSide.PROVIDER,
    },
  ];

  for (const { sobras, casados, tipo, lado } of lados) {
    for (const sobra of sobras) {
      if (!sobra.counterpartyTaxIdIndex) continue;
      const gemeo = casados.find(
        (item) => item.counterpartyTaxIdIndex === sobra.counterpartyTaxIdIndex,
      );
      if (!gemeo) continue;

      if (lado === ReconciliationSide.LOCAL) state.local.delete(sobra.id);
      else state.provider.delete(sobra.id);

      state.breaks.push({
        type: tipo,
        severity: BreakSeverity.HIGH,
        dedupeKey: dedupeKeyFor({
          endToEndId: sobra.endToEndId,
          accountId: sobra.accountId,
          providerItemId: lado === ReconciliationSide.PROVIDER ? sobra.id : undefined,
          localItemId: lado === ReconciliationSide.LOCAL ? sobra.id : undefined,
        }),
        effectiveDate: sobra.effectiveDate,
        endToEndId: sobra.endToEndId,
        amountCents: sobra.amountCents,
        providerItemId: lado === ReconciliationSide.PROVIDER ? sobra.id : undefined,
        localItemId: lado === ReconciliationSide.LOCAL ? sobra.id : undefined,
        description: 'Registro excedente com mesma conta, valor, data e contraparte',
        evidence: { duplicado_de: gemeo.id, lado },
      });
    }
  }
}
