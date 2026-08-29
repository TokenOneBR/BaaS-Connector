import { BreakType, MatchConfidence } from '@baasconn/taxonomy';

import {
  importIntent,
  missingOnProviderSeverity,
  orphanProviderBreakType,
  orphanProviderSeverity,
} from '../classify.js';
import { dedupeKeyFor } from '../match-key.js';
import { amountTolerance } from '../types.js';
import type { NormalizedItem } from '../types.js';

import type { PassState } from './strong.js';

export interface WindowedState extends PassState {
  now: Date;
  /** Itens locais suprimidos pela graca de liquidacao. Nao sao quebra. */
  pendingSettlement: string[];
}

/**
 * Passe 3 — fuzzy com janela, e o fecho da conta.
 *
 * E o ultimo passe sobre P e C: o que sobrar daqui vira quebra. Casa com
 * tolerancia de valor e de dias uteis, com confianca BAIXA e sempre marcado
 * para revisao — um casamento inferido por aproximacao nunca deveria virar
 * verdade sem alguem olhar.
 */
export function passWindowedFuzzy(state: WindowedState): void {
  const restantesProvedor = ordenar([...state.provider.values()]);

  for (const p of restantesProvedor) {
    if (!state.provider.has(p.id)) continue;
    const candidatos = ordenar(
      [...state.local.values()].filter((c) => dentroDaJanela(p, c, state)),
    );

    if (candidatos.length === 1) {
      const c = candidatos[0]!;
      state.provider.delete(p.id);
      state.local.delete(c.id);
      state.matches.push({
        providerItemId: p.id,
        localItemId: c.id,
        confidence: MatchConfidence.LOW,
        pass: 3,
        needsReview: true,
      });
      continue;
    }

    // Zero candidatos, ou mais de um. Com mais de um, casar seria escolher
    // qual pagamento e qual — e escolher errado aqui liga uma transacao nossa
    // a um movimento do provedor que nao e o dela.
    faltaNoLocal(state, p, candidatos.length > 1);
  }

  for (const c of ordenar([...state.local.values()])) {
    faltaNoProvedor(state, c);
  }
}

function ordenar(items: NormalizedItem[]): NormalizedItem[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

function dentroDaJanela(p: NormalizedItem, c: NormalizedItem, state: WindowedState): boolean {
  if (p.accountId !== c.accountId) return false;
  if (p.direction !== c.direction) return false;

  const delta = p.amountCents - c.amountCents;
  const absoluto = delta < 0n ? -delta : delta;
  const tolerancia =
    state.policy.amountToleranceCents >
    amountTolerance(c.amountCents, state.policy.amountToleranceBasisPoints)
      ? state.policy.amountToleranceCents
      : amountTolerance(c.amountCents, state.policy.amountToleranceBasisPoints);
  if (absoluto > tolerancia) return false;

  const dias = Math.abs(
    state.policy.calendar.businessDaysBetween(c.effectiveDate, p.effectiveDate),
  );
  return dias <= state.policy.dateToleranceBusinessDays;
}

function faltaNoLocal(state: WindowedState, p: NormalizedItem, ambiguo: boolean): void {
  state.provider.delete(p.id);
  const tipo = orphanProviderBreakType(p);
  state.breaks.push({
    type: tipo,
    severity: orphanProviderSeverity(p),
    dedupeKey: dedupeKeyFor({
      endToEndId: p.endToEndId,
      accountId: p.accountId,
      providerItemId: p.id,
    }),
    effectiveDate: p.effectiveDate,
    endToEndId: p.endToEndId,
    amountCents: p.amountCents,
    providerItemId: p.id,
    description: ambiguo
      ? 'Movimento do provedor com mais de um candidato local na janela'
      : 'Movimento no provedor sem registro correspondente no conector',
    evidence: {
      tipo_movimento: p.type,
      sentido: p.direction,
      ambiguo,
      valor_cents: p.amountCents.toString(),
    },
    // Importar so acontece em credito nao ambiguo, e a guarda esta no
    // `importIntent`: e o caminho de recuperacao de webhook perdido, e importar
    // um debito seria criar do nada uma transacao que tira dinheiro do cliente.
    autoResolution: tipo === BreakType.MISSING_ON_LOCAL ? importIntent(p, ambiguo) : undefined,
  });
}

/**
 * Falta no provedor, com a graca de liquidacao.
 *
 * A supressao e por ITEM, e nao pela janela: o PIX liquida na hora mas o
 * extrato posta em dia util, entao um movimento nosso de tres minutos atras
 * legitimamente ainda nao aparece la. Um movimento de ontem dentro de uma
 * janela recente, porem, JA deveria — suprimir pela janela esconderia
 * exatamente esse caso.
 */
function faltaNoProvedor(state: WindowedState, c: NormalizedItem): void {
  state.local.delete(c.id);

  const idadeMinutos = (state.now.getTime() - c.postedAt.getTime()) / 60_000;
  if (idadeMinutos < state.policy.settlementGraceMinutes) {
    state.pendingSettlement.push(c.id);
    return;
  }

  state.breaks.push({
    type: BreakType.MISSING_ON_PROVIDER,
    severity: missingOnProviderSeverity(c),
    dedupeKey: dedupeKeyFor({
      endToEndId: c.endToEndId,
      accountId: c.accountId,
      localItemId: c.id,
    }),
    effectiveDate: c.effectiveDate,
    endToEndId: c.endToEndId,
    amountCents: c.amountCents,
    localItemId: c.id,
    description: 'Registro do conector sem movimento correspondente no provedor',
    evidence: {
      tipo_movimento: c.type,
      sentido: c.direction,
      situacao: c.status ?? null,
      idade_minutos: Math.floor(idadeMinutos),
    },
    // Debito faltando no provedor NUNCA auto-resolve: pode significar que
    // registramos um pagamento que nao aconteceu, e a correcao — reverter no
    // razao ou escalar — exige julgamento.
  });
}
