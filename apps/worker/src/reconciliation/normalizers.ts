import type { LedgerMovement, TransactionRecord } from '@baasconn/api/domain';
import { LedgerTransactionType } from '@baasconn/ledger';
import type { StatementEntry } from '@baasconn/provider-spi';
import { fuzzyKey, strongKey, type NormalizedItem } from '@baasconn/reconciliation';
import { ReconciliationSide, TransactionStatus, newId, toEffectiveDate } from '@baasconn/taxonomy';

/**
 * Estados que a CONCILIACAO examina.
 *
 * Deliberadamente maior que `STATEMENT_STATUSES`, que e o extrato do cliente:
 * o extrato mostra o que ja aconteceu, a conciliacao precisa tambem do que
 * ALEGA ter acontecido. Um PIX out em `UNKNOWN` ausente do extrato do
 * provedor e precisamente o sinal que a escada persegue, e um `PENDING`
 * antigo que o provedor nunca viu e um pagamento fantasma.
 *
 * `CREATED`, `FAILED` e `CANCELLED` ficam de fora: nada se moveu.
 */
export const RECONCILIATION_STATUSES: readonly TransactionStatus[] = Object.freeze([
  TransactionStatus.PENDING,
  TransactionStatus.PROCESSING,
  TransactionStatus.UNKNOWN,
  TransactionStatus.SETTLED,
  TransactionStatus.REVERSED,
  TransactionStatus.PARTIALLY_REVERSED,
]);

/**
 * Tipos de transacao do razao que espelham movimento do provedor.
 *
 * O predicado e nomeado e testado sozinho porque errar nele e caro nos dois
 * sentidos: incluir `BLOCK_FUNDS` faria todo bloqueio judicial virar um
 * lancamento orfao CRITICAL falso — o provedor nunca tera contraparte para
 * ele —, e excluir `PIX_IN_RECEIVE` deixaria de fora exatamente a metade do
 * razao que a conciliacao existe para conferir.
 *
 * `PIX_OUT_AUTHORIZE` fica de fora porque a fase PENDENTE nao e movimento;
 * quem aparece e o `PIX_OUT_SETTLE` que a resolve. `RECONCILIATION_ADJUSTMENT`
 * fica de fora porque e a CORRECAO de uma quebra: incluí-lo faria o ajuste
 * de ontem virar a quebra de hoje.
 */
export function mirrorsProviderMovement(type: LedgerTransactionType): boolean {
  switch (type) {
    case LedgerTransactionType.PIX_IN_RECEIVE:
    case LedgerTransactionType.PIX_OUT_SETTLE:
    case LedgerTransactionType.PIX_REFUND_IN:
    case LedgerTransactionType.PIX_REFUND_OUT:
    case LedgerTransactionType.FEE_CHARGE:
    case LedgerTransactionType.FEE_REVERSAL:
      return true;
    default:
      return false;
  }
}

/** O id do item de conciliacao e cunhado AQUI, antes do motor. */
function itemId(): string {
  return newId('reconciliationItem');
}

export function fromStatementEntry(entry: StatementEntry, accountId: string): NormalizedItem {
  const direction = entry.direction === 'credit' ? 'CREDIT' : 'DEBIT';
  const amountCents = BigInt(entry.amount.amount);
  const effectiveDate = entry.effectiveDate;

  return {
    id: itemId(),
    side: ReconciliationSide.PROVIDER,
    accountId,
    externalId: entry.providerEntryId,
    endToEndId: entry.endToEndId,
    providerTransactionId: entry.providerTransactionId ?? entry.providerEntryId,
    postedAt: new Date(entry.postedAt),
    effectiveDate,
    direction,
    amountCents,
    type: entry.type,
    matchKeyStrong: strongKey({
      endToEndId: entry.endToEndId,
      providerTransactionId: entry.providerTransactionId ?? entry.providerEntryId,
    }),
    matchKeyFuzzy: fuzzyKey({ accountId, direction, amountCents, effectiveDate }),
    // Redigido e sem `bigint`: vai para coluna Json, e `stringify` lanca.
    raw: { provider_entry_id: entry.providerEntryId, tipo: entry.type, situacao: 'PROVIDER' },
  };
}

export function fromTransaction(transaction: TransactionRecord): NormalizedItem {
  const direction = transaction.direction === 'CREDIT' ? 'CREDIT' : 'DEBIT';
  const amountCents = transaction.amountCents;
  const effectiveDate = transaction.effectiveDate;

  return {
    id: itemId(),
    side: ReconciliationSide.LOCAL,
    accountId: transaction.accountId,
    externalId: transaction.id,
    endToEndId: transaction.pix?.endToEndId ?? undefined,
    providerTransactionId: transaction.providerTransactionId ?? undefined,
    ledgerTransactionId: transaction.ledgerPostedTransactionId ?? undefined,
    postedAt: transaction.settledAt ?? transaction.requestedAt,
    effectiveDate,
    direction,
    amountCents,
    type: transaction.type,
    status: transaction.status,
    // Blind index, nunca o documento.
    counterpartyTaxIdIndex: transaction.pix?.counterparty?.taxIdIndex ?? undefined,
    matchKeyStrong: strongKey({
      endToEndId: transaction.pix?.endToEndId ?? undefined,
      providerTransactionId: transaction.providerTransactionId ?? undefined,
    }),
    matchKeyFuzzy: fuzzyKey({
      accountId: transaction.accountId,
      direction,
      amountCents,
      effectiveDate,
    }),
    raw: { transaction_id: transaction.id, tipo: transaction.type, situacao: transaction.status },
  };
}

export function fromLedgerMovement(movement: LedgerMovement, accountId: string): NormalizedItem {
  const effectiveDate = toEffectiveDate(movement.effectiveAt);

  return {
    id: itemId(),
    side: ReconciliationSide.LEDGER,
    accountId,
    externalId: movement.entryId,
    ledgerTransactionId: movement.transactionId,
    postedAt: movement.effectiveAt,
    effectiveDate,
    direction: movement.direction,
    amountCents: movement.amountCents,
    type: movement.type,
    matchKeyFuzzy: fuzzyKey({
      accountId,
      direction: movement.direction,
      amountCents: movement.amountCents,
      effectiveDate,
    }),
    raw: { ledger_transaction_id: movement.transactionId, tipo: movement.type },
  };
}
