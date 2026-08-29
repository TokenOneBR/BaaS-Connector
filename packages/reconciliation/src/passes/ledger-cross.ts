import { BreakSeverity, BreakType } from '@baasconn/taxonomy';

import { dedupeKeyFor } from '../match-key.js';
import type { BreakDraft, MatchLink, NormalizedItem, ReconciliationPolicy } from '../types.js';

export interface LedgerCrossState {
  matches: MatchLink[];
  breaks: BreakDraft[];
  /** TODOS os itens locais da janela, casados ou nao, indexados por id. */
  allLocal: ReadonlyMap<string, NormalizedItem>;
  /** Pool consumivel do razao, indexado por id do ITEM. */
  ledger: Map<string, NormalizedItem>;
  policy: ReconciliationPolicy;
}

/**
 * Passe 4 — cruzamento com o razao sombra.
 *
 * E o passe que justifica conciliar em TRES vias em vez de duas. P<->C pega
 * webhook perdido e pagamento fantasma; so P<->C<->L pega o caso em que
 * registramos a transacao certa e lancamos errado no razao — o bug que
 * efetivamente custa dinheiro, e que uma conciliacao de duas vias declara
 * conciliado.
 *
 * O lado L chega AGREGADO POR TRANSACAO, nunca por lancamento: um
 * `LedgerEntry` e meia transacao, e emitir um item por perna faria este passe
 * contar cada transacao duas vezes e a assercao de saldo dobrar.
 */
export function passLedgerCross(state: LedgerCrossState): void {
  const porTransacao = indexarPorTransacao(state.ledger);

  for (const match of state.matches) {
    if (!match.localItemId) continue;
    const c = state.allLocal.get(match.localItemId);
    if (!c) continue;

    const grupo = c.ledgerTransactionId ? porTransacao.get(c.ledgerTransactionId) : undefined;
    if (!grupo) {
      faltaNoRazao(state, c);
      continue;
    }

    const l = consumir(state, grupo);
    match.ledgerItemId = l.id;
    conferirPerna(state, c, l);
  }

  // Itens locais que NAO casaram ja tem quebra propria do passe 3. Consumir o
  // lancamento deles aqui evita reportar o mesmo problema duas vezes, com
  // nomes diferentes, na mesma execucao.
  for (const c of state.allLocal.values()) {
    if (!c.ledgerTransactionId) continue;
    const grupo = porTransacao.get(c.ledgerTransactionId);
    if (grupo) consumir(state, grupo);
  }

  for (const orfao of [...state.ledger.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    lancamentoOrfao(state, orfao);
  }
}

/**
 * Agrupa por transacao de razao, e nao por item.
 *
 * O contrato de entrada e um item por TRANSACAO — mas se o worker vazar uma
 * perna a mais, consumir so o representante deixaria a outra sobrando, e ela
 * sairia como lancamento orfao CRITICAL sobre uma transacao que este passe
 * acabou de dar por conciliada. Uma quebra critica inventada custa mais caro
 * que a duplicidade que a originou.
 */
function indexarPorTransacao(
  ledger: ReadonlyMap<string, NormalizedItem>,
): Map<string, NormalizedItem[]> {
  const porTransacao = new Map<string, NormalizedItem[]>();
  for (const item of ledger.values()) {
    const chave = item.ledgerTransactionId ?? item.id;
    const grupo = porTransacao.get(chave) ?? [];
    grupo.push(item);
    porTransacao.set(chave, grupo);
  }
  // Menor id primeiro, para o representante nao depender da ordem do SELECT.
  for (const grupo of porTransacao.values()) grupo.sort((a, b) => a.id.localeCompare(b.id));
  return porTransacao;
}

/** Tira o grupo inteiro do pool e devolve o representante. */
function consumir(state: LedgerCrossState, grupo: readonly NormalizedItem[]): NormalizedItem {
  for (const item of grupo) state.ledger.delete(item.id);
  return grupo[0]!;
}

function faltaNoRazao(state: LedgerCrossState, c: NormalizedItem): void {
  state.breaks.push({
    type: BreakType.MISSING_ON_LEDGER,
    // SEMPRE critico, e o comentario do enum na taxonomia ja decidiu isso: e o
    // caso em que o extrato do cliente e o saldo do cliente discordam.
    severity: BreakSeverity.CRITICAL,
    dedupeKey: dedupeKeyFor({
      endToEndId: c.endToEndId,
      accountId: c.accountId,
      localItemId: c.id,
    }),
    effectiveDate: c.effectiveDate,
    endToEndId: c.endToEndId,
    amountCents: c.amountCents,
    localItemId: c.id,
    description: 'Transacao casada com o provedor e sem lancamento no razao sombra',
    evidence: {
      ledger_transaction_id: c.ledgerTransactionId ?? null,
      sentido: c.direction,
      valor_cents: c.amountCents.toString(),
    },
  });
}

/**
 * Valor ou data do lancamento divergindo do registro canonico.
 *
 * CRITICAL sem olhar o delta, ao contrario do passe 1: uma divergencia de um
 * centavo entre o provedor e nos e ruido de arredondamento do provedor; entre
 * NOS e o NOSSO razao e um defeito nosso, e nao existe delta aceitavel.
 */
function conferirPerna(state: LedgerCrossState, c: NormalizedItem, l: NormalizedItem): void {
  if (l.amountCents !== c.amountCents) {
    const delta = l.amountCents - c.amountCents;
    state.breaks.push({
      type: BreakType.AMOUNT_MISMATCH,
      severity: BreakSeverity.CRITICAL,
      dedupeKey: dedupeKeyFor({
        endToEndId: c.endToEndId,
        accountId: c.accountId,
        localItemId: c.id,
      }),
      effectiveDate: c.effectiveDate,
      endToEndId: c.endToEndId,
      amountCents: c.amountCents,
      deltaCents: delta,
      localItemId: c.id,
      ledgerItemId: l.id,
      description: 'Lancamento do razao sombra diverge em valor do registro canonico',
      evidence: {
        razao_cents: l.amountCents.toString(),
        local_cents: c.amountCents.toString(),
        delta_cents: delta.toString(),
      },
    });
  }

  if (l.effectiveDate !== c.effectiveDate) {
    const dias = state.policy.calendar.businessDaysBetween(c.effectiveDate, l.effectiveDate);
    state.breaks.push({
      type: BreakType.DATE_MISMATCH,
      severity: BreakSeverity.MEDIUM,
      dedupeKey: dedupeKeyFor({
        endToEndId: c.endToEndId,
        accountId: c.accountId,
        localItemId: c.id,
      }),
      effectiveDate: c.effectiveDate,
      endToEndId: c.endToEndId,
      amountCents: c.amountCents,
      localItemId: c.id,
      ledgerItemId: l.id,
      description: 'Lancamento do razao sombra em data efetiva diferente do registro canonico',
      evidence: { razao: l.effectiveDate, local: c.effectiveDate, dias_uteis: dias },
    });
  }
}

/**
 * Lancamento de razao sem par (P,C).
 *
 * Significa que lancamos duas vezes ou lancamos do nada — a outra metade da
 * classe de bug que o razao sombra existe para pegar.
 *
 * Nenhum dos onze `BreakType` nomeia isso. Sai como `MISSING_ON_LOCAL` com
 * `ledgerItemId` preenchido e `providerItemId` AUSENTE, o que e exatamente a
 * guarda que impede a auto-resolucao de importacao de disparar: `importIntent`
 * exige um item de provedor, e aqui nao ha nenhum. `ORPHAN_LEDGER_ENTRY` no
 * enum e follow-up.
 */
function lancamentoOrfao(state: LedgerCrossState, l: NormalizedItem): void {
  state.breaks.push({
    type: BreakType.MISSING_ON_LOCAL,
    severity: BreakSeverity.CRITICAL,
    dedupeKey: dedupeKeyFor({ accountId: l.accountId, ledgerItemId: l.id }),
    effectiveDate: l.effectiveDate,
    amountCents: l.amountCents,
    ledgerItemId: l.id,
    description: 'Lancamento no razao sombra sem transacao correspondente',
    evidence: {
      ledger_transaction_id: l.ledgerTransactionId ?? null,
      sentido: l.direction,
      valor_cents: l.amountCents.toString(),
    },
  });
}
