import { BreakSeverity, BreakType, MatchConfidence, ReconciliationSide } from '@baasconn/taxonomy';

import {
  amountMismatchSeverity,
  dateMismatchSeverity,
  statusIntent,
  statusMismatchSeverity,
  timingIntent,
} from '../classify.js';
import { dedupeKeyFor } from '../match-key.js';
import type { BreakDraft, MatchLink, NormalizedItem, ReconciliationPolicy } from '../types.js';

export interface PassState {
  provider: Map<string, NormalizedItem>;
  local: Map<string, NormalizedItem>;
  matches: MatchLink[];
  breaks: BreakDraft[];
  policy: ReconciliationPolicy;
}

/**
 * Passe 1 — chave forte.
 *
 * Roda PRIMEIRO, e a ordem e regra e nao preferencia: o passe fuzzy pareia por
 * `postedAt` mais proximo e roubaria um casamento que o E2EID faria com
 * certeza. Dois pares cruzados no mesmo balde viram dois pares errados.
 */
export function passStrong(state: PassState): void {
  // E2EID antes de providerTransactionId: o primeiro e globalmente unico no
  // PIX; o segundo so e unico dentro do provedor.
  for (const prefixo of ['e2e:', 'ptx:']) {
    const porChave = indexBy(state.provider, prefixo);
    const locais = indexBy(state.local, prefixo);

    for (const [chave, doProvedor] of porChave) {
      const doLocal = locais.get(chave);
      if (!doLocal || doLocal.length === 0) continue;

      duplicates(state, doProvedor, doLocal, chave);

      const p = escolherMaisAntigo(doProvedor);
      const c = escolherMaisAntigo(doLocal);
      if (!p || !c) continue;

      state.provider.delete(p.id);
      state.local.delete(c.id);
      state.matches.push({
        providerItemId: p.id,
        localItemId: c.id,
        confidence: MatchConfidence.EXACT,
        pass: 1,
        needsReview: false,
      });

      // O casamento por chave forte e CERTO. O que diverge e o conteudo, e
      // desfaze-lo por causa disso perderia a unica ligacao confiavel que
      // existe entre os dois lados.
      compareAttributes(state, p, c);
    }
  }
}

function indexBy(
  items: Map<string, NormalizedItem>,
  prefixo: string,
): Map<string, NormalizedItem[]> {
  const porChave = new Map<string, NormalizedItem[]>();
  for (const item of items.values()) {
    if (!item.matchKeyStrong?.startsWith(prefixo)) continue;
    const lista = porChave.get(item.matchKeyStrong) ?? [];
    lista.push(item);
    porChave.set(item.matchKeyStrong, lista);
  }
  return porChave;
}

/** ULID e ordenavel no tempo; o desempate por id mantem o resultado estavel. */
function escolherMaisAntigo(items: NormalizedItem[]): NormalizedItem | undefined {
  return [...items].sort(
    (a, b) => a.postedAt.getTime() - b.postedAt.getTime() || a.id.localeCompare(b.id),
  )[0];
}

/**
 * Duas linhas com a MESMA chave forte sao duplicata, sem ambiguidade.
 *
 * O E2EID e globalmente unico no PIX: se ha dois do nosso lado, gravamos duas
 * vezes o mesmo pagamento.
 */
function duplicates(
  state: PassState,
  doProvedor: NormalizedItem[],
  doLocal: NormalizedItem[],
  chave: string,
): void {
  const extras: Array<[NormalizedItem[], BreakType, ReconciliationSide]> = [
    [doLocal, BreakType.DUPLICATE_LOCAL, ReconciliationSide.LOCAL],
    [doProvedor, BreakType.DUPLICATE_PROVIDER, ReconciliationSide.PROVIDER],
  ];

  for (const [lista, tipo, lado] of extras) {
    if (lista.length <= 1) continue;
    const primeiro = escolherMaisAntigo(lista)!;
    const duplicados = lista.filter((item) => item.id !== primeiro.id);

    for (const item of duplicados) {
      if (lado === ReconciliationSide.LOCAL) state.local.delete(item.id);
      else state.provider.delete(item.id);

      state.breaks.push({
        type: tipo,
        severity: BreakSeverity.HIGH,
        dedupeKey: dedupeKeyFor({
          endToEndId: item.endToEndId,
          accountId: item.accountId,
          providerItemId: lado === ReconciliationSide.PROVIDER ? item.id : undefined,
          localItemId: lado === ReconciliationSide.LOCAL ? item.id : undefined,
        }),
        effectiveDate: item.effectiveDate,
        endToEndId: item.endToEndId,
        amountCents: item.amountCents,
        providerItemId: lado === ReconciliationSide.PROVIDER ? item.id : undefined,
        localItemId: lado === ReconciliationSide.LOCAL ? item.id : undefined,
        description: `Mais de um registro com a mesma chave forte ${chave}`,
        evidence: { chave, duplicado_de: primeiro.id, lado },
      });
    }
  }
}

function compareAttributes(state: PassState, p: NormalizedItem, c: NormalizedItem): void {
  if (p.amountCents !== c.amountCents) {
    const delta = p.amountCents - c.amountCents;
    state.breaks.push({
      type: BreakType.AMOUNT_MISMATCH,
      severity: amountMismatchSeverity(delta, state.policy),
      dedupeKey: dedupeKeyFor({
        endToEndId: p.endToEndId,
        accountId: p.accountId,
        localItemId: c.id,
      }),
      effectiveDate: c.effectiveDate,
      endToEndId: p.endToEndId,
      amountCents: c.amountCents,
      deltaCents: delta,
      providerItemId: p.id,
      localItemId: c.id,
      description: 'Valor do provedor diverge do nosso registro',
      evidence: {
        provedor_cents: p.amountCents.toString(),
        local_cents: c.amountCents.toString(),
        delta_cents: delta.toString(),
      },
    });
  }

  if (p.status && c.status && p.status !== c.status) {
    state.breaks.push({
      type: BreakType.STATUS_MISMATCH,
      severity: statusMismatchSeverity(c.status, p.status),
      dedupeKey: dedupeKeyFor({
        endToEndId: p.endToEndId,
        accountId: p.accountId,
        localItemId: c.id,
      }),
      effectiveDate: c.effectiveDate,
      endToEndId: p.endToEndId,
      amountCents: c.amountCents,
      providerItemId: p.id,
      localItemId: c.id,
      description: `Provedor diz ${p.status}, nosso registro diz ${c.status}`,
      evidence: { provedor: p.status, local: c.status },
      autoResolution: statusIntent(c.id, c.status, p.status),
    });
  }

  if (p.effectiveDate !== c.effectiveDate) {
    const drift = state.policy.calendar.businessDaysBetween(c.effectiveDate, p.effectiveDate);
    state.breaks.push({
      type: BreakType.DATE_MISMATCH,
      severity: dateMismatchSeverity(drift, state.policy),
      dedupeKey: dedupeKeyFor({
        endToEndId: p.endToEndId,
        accountId: p.accountId,
        localItemId: c.id,
      }),
      effectiveDate: c.effectiveDate,
      endToEndId: p.endToEndId,
      amountCents: c.amountCents,
      providerItemId: p.id,
      localItemId: c.id,
      description: `Data efetiva diverge em ${drift} dia(s) util(eis)`,
      evidence: { provedor: p.effectiveDate, local: c.effectiveDate, dias_uteis: drift },
      autoResolution: timingIntent({
        localItemId: c.id,
        providerItemId: p.id,
        driftBusinessDays: drift,
        policy: state.policy,
      }),
    });
  }
}
