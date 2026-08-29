import { createHash } from 'node:crypto';

import type { Direction, EffectiveDate } from './types.js';

/**
 * Chave forte, com NAMESPACE.
 *
 * O namespace nao e decoracao. Um provedor que use o E2EID como
 * `providerTransactionId` produziria, sem ele, um casamento entre o E2EID de
 * um item e o `providerTransactionId` de OUTRO — casamento errado com
 * confianca `EXACT`, que e o pior desfecho possivel: ninguem revisa o que o
 * sistema declarou exato.
 */
export function strongKey(input: {
  endToEndId?: string;
  providerTransactionId?: string;
}): string | undefined {
  if (input.endToEndId) return `e2e:${input.endToEndId}`;
  if (input.providerTransactionId) return `ptx:${input.providerTransactionId}`;
  return undefined;
}

/**
 * Chave fuzzy: `sha256(conta|sentido|valor|data)`.
 *
 * A forma vem do schema (`reconciliation_item.match_key_fuzzy`), que ja
 * documenta e indexa exatamente isto.
 */
export function fuzzyKey(input: {
  accountId: string;
  direction: Direction;
  amountCents: bigint;
  effectiveDate: EffectiveDate;
}): string {
  return createHash('sha256')
    .update(
      `${input.accountId}|${input.direction}|${input.amountCents.toString()}|${input.effectiveDate}`,
    )
    .digest('hex');
}

/**
 * Chave de deduplicacao de quebra.
 *
 * Derivada e NOT NULL. O E2EID sozinho nao serve: e nullable, e em Postgres
 * NULL nunca e igual a NULL num indice unico — a quebra sem E2EID se
 * multiplicaria a cada execucao. E colapsar todas elas numa chave fixa seria
 * pior: dois debitos fantasma distintos no mesmo dia virariam uma quebra so, e
 * o operador resolveria uma achando que resolveu as duas.
 */
export function dedupeKeyFor(input: {
  endToEndId?: string;
  accountId: string;
  providerItemId?: string;
  localItemId?: string;
  ledgerItemId?: string;
  isBalanceBreak?: boolean;
}): string {
  if (input.endToEndId) return `e2e:${input.endToEndId}`;
  // Uma quebra de saldo por conta por dia — que e exatamente o escopo de um
  // saldo.
  if (input.isBalanceBreak) return `bal:${input.accountId}`;
  if (input.providerItemId) return `pitem:${input.providerItemId}`;
  if (input.localItemId ?? input.ledgerItemId) {
    return `litem:${input.localItemId ?? input.ledgerItemId}`;
  }
  return `acct:${input.accountId}`;
}
