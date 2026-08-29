import { passBalance } from './passes/balance.js';
import { passDeterministicFuzzy } from './passes/deterministic-fuzzy.js';
import { passLedgerCross } from './passes/ledger-cross.js';
import { passStrong } from './passes/strong.js';
import { passWindowedFuzzy } from './passes/windowed-fuzzy.js';
import type {
  BreakDraft,
  MatchLink,
  NormalizedItem,
  ReconciliationInput,
  ReconciliationResult,
} from './types.js';

/**
 * O motor.
 *
 * Cinco passes, cada um consumindo do pool que o anterior deixou. A ORDEM e
 * regra, nao preferencia — ver o comentario de cada passe.
 *
 * Devolve um PLANO, nunca efeitos: casamentos, rascunhos de quebra,
 * contadores e intencoes de auto-resolucao. Nada e persistido aqui, e e isso
 * que torna possivel rodar contra a janela de ontem em producao e VER as
 * quebras que ele abriria, sem escrever uma linha.
 */
export function reconcile(input: ReconciliationInput): ReconciliationResult {
  const provider = indexar(input.provider);
  const local = indexar(input.local);
  const ledger = indexar(input.ledger);
  const todosProvider = indexar(input.provider);
  const todosLocal = indexar(input.local);

  const matches: MatchLink[] = [];
  const breaks: BreakDraft[] = [];
  const pendingSettlement: string[] = [];

  const state = {
    provider,
    local,
    matches,
    breaks,
    policy: input.policy,
    now: input.now,
    pendingSettlement,
  };

  passStrong(state);
  passDeterministicFuzzy(state);
  passWindowedFuzzy(state);
  passLedgerCross({ matches, breaks, allLocal: todosLocal, ledger, policy: input.policy });
  const balance = passBalance({ input, matches, breaks, allProvider: todosProvider });

  return {
    matches,
    breaks,
    counters: {
      providerItemCount: input.provider.length,
      localItemCount: input.local.length,
      ledgerItemCount: input.ledger.length,
      matchedCount: matches.length,
      breakCount: breaks.length,
    },
    balance,
    pendingSettlement,
  };
}

function indexar(items: readonly NormalizedItem[]): Map<string, NormalizedItem> {
  return new Map(items.map((item) => [item.id, item]));
}
