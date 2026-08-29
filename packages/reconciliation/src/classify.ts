import {
  BreakSeverity,
  BreakType,
  ResolutionAction,
  TRANSACTION_STATUS_RANKS,
  TRANSACTION_STATUS_TRANSITIONS,
  TransactionStatus,
  checkTransition,
} from '@baasconn/taxonomy';

import type { AutoResolutionIntent, NormalizedItem, ReconciliationPolicy } from './types.js';

/**
 * Severidade de `MISSING_ON_LOCAL`.
 *
 * Credito e webhook perdido — rotina chata, resolvel sozinha. Debito e o
 * provedor tendo tirado dinheiro que nunca pedimos, e isso e critico.
 */
export function missingOnLocalSeverity(item: NormalizedItem): BreakSeverity {
  return item.direction === 'CREDIT' ? BreakSeverity.HIGH : BreakSeverity.CRITICAL;
}

/**
 * Severidade de `MISSING_ON_PROVIDER`.
 *
 * Debito e o caso perigoso: pode significar que registramos um pagamento que
 * nao aconteceu.
 */
export function missingOnProviderSeverity(item: NormalizedItem): BreakSeverity {
  return item.direction === 'DEBIT' ? BreakSeverity.CRITICAL : BreakSeverity.HIGH;
}

export function amountMismatchSeverity(
  deltaCents: bigint,
  policy: ReconciliationPolicy,
): BreakSeverity {
  const absoluto = deltaCents < 0n ? -deltaCents : deltaCents;
  return absoluto > policy.criticalAmountDeltaCents ? BreakSeverity.CRITICAL : BreakSeverity.MEDIUM;
}

/**
 * O provedor esta a FRENTE do nosso registro?
 *
 * Duas condicoes, e as duas importam: rank maior (informacao mais avancada) e
 * transicao legal. Um provedor dizendo `SETTLED` sobre algo que registramos
 * como `FAILED` tem rank igual e transicao ilegal — nao e "estar a frente", e
 * contradicao, e aplicar seria deixar a maquina de estados nao significar
 * nada.
 */
export function providerIsAhead(local: TransactionStatus, provider: TransactionStatus): boolean {
  if (local === provider) return false;
  if ((TRANSACTION_STATUS_RANKS[provider] ?? 0) <= (TRANSACTION_STATUS_RANKS[local] ?? 0)) {
    return false;
  }
  return checkTransition(TRANSACTION_STATUS_TRANSITIONS, local, provider).allowed;
}

/**
 * Contamos ao cliente um movimento que nao houve?
 *
 * Local `SETTLED` com provedor `FAILED`/`CANCELLED` e sempre critico e NUNCA
 * auto-resolve: reverter um `SETTLED` mexe no extrato do cliente.
 */
export function localClaimsSettledButProviderFailed(
  local: TransactionStatus,
  provider: TransactionStatus,
): boolean {
  return (
    local === TransactionStatus.SETTLED &&
    (provider === TransactionStatus.FAILED || provider === TransactionStatus.CANCELLED)
  );
}

export function statusMismatchSeverity(
  local: TransactionStatus,
  provider: TransactionStatus,
): BreakSeverity {
  return localClaimsSettledButProviderFailed(local, provider)
    ? BreakSeverity.CRITICAL
    : BreakSeverity.MEDIUM;
}

/**
 * Auto-resolucao de `MISSING_ON_LOCAL`.
 *
 * SO credito, SO com item de provedor, e SO quando nao ha ambiguidade. E o
 * caminho de recuperacao de webhook perdido — a coisa de maior valor que a
 * conciliacao faz — mas importar um debito seria criar do nada uma transacao
 * que tira dinheiro do cliente.
 */
export function importIntent(
  item: NormalizedItem,
  ambiguous: boolean,
): AutoResolutionIntent | undefined {
  if (ambiguous) return undefined;
  if (item.direction !== 'CREDIT') return undefined;
  if (item.side !== 'PROVIDER') return undefined;
  return { action: ResolutionAction.IMPORT_FROM_PROVIDER, providerItemId: item.id };
}

export function statusIntent(
  localItemId: string,
  local: TransactionStatus,
  provider: TransactionStatus,
): AutoResolutionIntent | undefined {
  if (!providerIsAhead(local, provider)) return undefined;
  return {
    action: ResolutionAction.MARK_PROVIDER_AUTHORITATIVE,
    localItemId,
    fromStatus: local,
    toStatus: provider,
  };
}

export function timingIntent(input: {
  localItemId: string;
  providerItemId: string;
  driftBusinessDays: number;
  policy: ReconciliationPolicy;
}): AutoResolutionIntent | undefined {
  if (input.driftBusinessDays > input.policy.autoResolveDateWithinBusinessDays) return undefined;
  return {
    action: ResolutionAction.IGNORE_TIMING_DIFFERENCE,
    localItemId: input.localItemId,
    providerItemId: input.providerItemId,
    driftBusinessDays: input.driftBusinessDays,
  };
}

export function dateMismatchSeverity(
  driftBusinessDays: number,
  policy: ReconciliationPolicy,
): BreakSeverity {
  return driftBusinessDays <= policy.autoResolveDateWithinBusinessDays
    ? BreakSeverity.LOW
    : BreakSeverity.MEDIUM;
}

/** Tipo de quebra de um item de provedor orfao, pelo tipo do lancamento. */
export function orphanProviderBreakType(item: NormalizedItem): BreakType {
  if (item.type === 'FEE') return BreakType.UNMATCHED_FEE;
  if (item.type === 'REFUND') return BreakType.ORPHAN_REFUND;
  return BreakType.MISSING_ON_LOCAL;
}

export function orphanProviderSeverity(item: NormalizedItem): BreakSeverity {
  switch (orphanProviderBreakType(item)) {
    case BreakType.UNMATCHED_FEE:
      // Importar tarifa exige perna de razao e tabela de precos que o conector
      // nao tem: e trabalho humano, nao automatico.
      return BreakSeverity.MEDIUM;
    case BreakType.ORPHAN_REFUND:
      // Devolucao de pagamento que nao conhecemos e fraude ou bug de
      // mapeamento; nenhum dos dois se resolve sozinho.
      return BreakSeverity.HIGH;
    default:
      return missingOnLocalSeverity(item);
  }
}
