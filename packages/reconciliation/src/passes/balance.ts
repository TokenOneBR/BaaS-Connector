import { BreakSeverity, BreakType } from '@baasconn/taxonomy';

import { dedupeKeyFor } from '../match-key.js';
import type {
  BreakDraft,
  MatchLink,
  NormalizedItem,
  ReconciliationInput,
  ReconciliationResult,
} from '../types.js';

export interface BalanceState {
  input: ReconciliationInput;
  matches: readonly MatchLink[];
  breaks: BreakDraft[];
  allProvider: ReadonlyMap<string, NormalizedItem>;
}

/**
 * Passe 5 — assercao de saldo.
 *
 * `abertura + Σ movimentos casados ?= fechamento`. E a rede que pega o que os
 * quatro passes anteriores nao pegam: um movimento que existe nos dois lados,
 * casa perfeitamente, e mesmo assim nao explica o saldo — tarifa nao extratada,
 * bloqueio judicial, estorno lancado fora da janela.
 */
export function passBalance(state: BalanceState): ReconciliationResult['balance'] {
  const { providerOpeningCents, providerClosingCents, ledgerClosingCents } = state.input.balances;

  // O movimento e somado pelo lado do PROVEDOR, porque a abertura e o
  // fechamento tambem sao dele. Misturar o valor do nosso lado aqui faria um
  // `AMOUNT_MISMATCH` ja reportado no passe 1 aparecer de novo, disfarcado de
  // divergencia de saldo.
  let movimento = 0n;
  for (const match of state.matches) {
    if (!match.providerItemId) continue;
    const p = state.allProvider.get(match.providerItemId);
    if (!p) continue;
    movimento += p.direction === 'CREDIT' ? p.amountCents : -p.amountCents;
  }

  const delta =
    providerClosingCents !== undefined && ledgerClosingCents !== undefined
      ? providerClosingCents - ledgerClosingCents
      : undefined;

  const base: ReconciliationResult['balance'] = {
    openingCents: providerOpeningCents,
    matchedMovementCents: movimento,
    providerClosingCents,
    ledgerClosingCents,
    balanceDeltaCents: delta,
  };

  if (providerOpeningCents === undefined) return { ...base, skippedReason: 'no_provider_opening' };
  if (providerClosingCents === undefined) return { ...base, skippedReason: 'no_provider_closing' };

  const esperado = providerOpeningCents + movimento;
  const residuo = providerClosingCents - esperado;
  const resultado: ReconciliationResult['balance'] = { ...base, expectedClosingCents: esperado };
  if (residuo === 0n) return resultado;

  // So vira quebra quando NAO ha quebra de item. Com quebras de item abertas,
  // o residuo ja tem explicacao e um `BALANCE_MISMATCH` a mais seria a mesma
  // noticia contada duas vezes — e o painel de conciliacao vive de o operador
  // acreditar que cada linha e um problema distinto.
  if (state.breaks.length > 0) return resultado;

  state.breaks.push({
    type: BreakType.BALANCE_MISMATCH,
    severity: BreakSeverity.CRITICAL,
    dedupeKey: dedupeKeyFor({ accountId: state.input.accountId, isBalanceBreak: true }),
    effectiveDate: dataDaJanela(state.input),
    deltaCents: residuo,
    description: 'Saldo de fechamento do provedor nao fecha com os movimentos casados',
    evidence: {
      abertura_cents: providerOpeningCents.toString(),
      movimento_casado_cents: movimento.toString(),
      fechamento_esperado_cents: esperado.toString(),
      fechamento_provedor_cents: providerClosingCents.toString(),
      fechamento_razao_cents: ledgerClosingCents?.toString() ?? null,
      residuo_cents: residuo.toString(),
    },
  });

  return resultado;
}

/**
 * Data contabil da quebra de saldo: o fim da janela, em Brasilia.
 *
 * Nao `now`: uma execucao noturna sobre a janela de ontem abriria a quebra com
 * a data de hoje, e a quebra apontaria para o dia errado no painel.
 */
function dataDaJanela(input: ReconciliationInput): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(input.window.end);
}
