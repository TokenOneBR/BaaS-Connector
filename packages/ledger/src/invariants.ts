import { EntryDirection, EntryPhase, type LedgerAccount, type LedgerEntry } from './types.js';

export interface InvariantViolation {
  invariant: string;
  detail: string;
}

/**
 * Verifica as invariantes que precisam valer sempre.
 *
 * A metrica `baas_ledger_imbalance_detected_total` vem daqui e precisa ficar
 * permanentemente em zero: qualquer incremento e incidente, nao alerta.
 */
export function checkInvariants(
  accounts: readonly LedgerAccount[],
  entries: readonly LedgerEntry[],
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];

  // 1. Cada transacao e balanceada por si.
  const byTransaction = new Map<string, LedgerEntry[]>();
  for (const entry of entries) {
    const list = byTransaction.get(entry.transactionId) ?? [];
    list.push(entry);
    byTransaction.set(entry.transactionId, list);
  }

  for (const [transactionId, group] of byTransaction) {
    let debits = 0n;
    let credits = 0n;
    for (const entry of group) {
      if (entry.direction === EntryDirection.DEBIT) debits += entry.amountCents;
      else credits += entry.amountCents;
    }
    if (debits !== credits) {
      violations.push({
        invariant: 'transaction_balanced',
        detail: `Transacao ${transactionId}: debitos ${debits} e creditos ${credits}`,
      });
    }
  }

  // 2. O razao inteiro soma zero.
  let totalDebits = 0n;
  let totalCredits = 0n;
  for (const entry of entries) {
    if (entry.direction === EntryDirection.DEBIT) totalDebits += entry.amountCents;
    else totalCredits += entry.amountCents;
  }
  if (totalDebits !== totalCredits) {
    violations.push({
      invariant: 'ledger_balanced',
      detail: `Razao inteiro: debitos ${totalDebits} e creditos ${totalCredits}`,
    });
  }

  // 3. Contadores materializados batem com os lancamentos.
  //    E o teste que pega drift entre contador e realidade, que e o unico
  //    risco real de materializar saldo.
  const expected = new Map<string, { dp: bigint; cp: bigint; dpend: bigint; cpend: bigint }>();
  for (const entry of entries) {
    const acc = expected.get(entry.accountId) ?? { dp: 0n, cp: 0n, dpend: 0n, cpend: 0n };
    const isDebit = entry.direction === EntryDirection.DEBIT;
    if (entry.phase === EntryPhase.POSTED) {
      if (isDebit) acc.dp += entry.amountCents;
      else acc.cp += entry.amountCents;
    } else if (entry.phase === EntryPhase.PENDING) {
      if (isDebit) acc.dpend += entry.amountCents;
      else acc.cpend += entry.amountCents;
    }
    expected.set(entry.accountId, acc);
  }

  for (const account of accounts) {
    const want = expected.get(account.id) ?? { dp: 0n, cp: 0n, dpend: 0n, cpend: 0n };
    if (account.debitsPosted !== want.dp || account.creditsPosted !== want.cp) {
      violations.push({
        invariant: 'posted_counters_match_entries',
        detail:
          `Conta ${account.code}: contadores postados (${account.debitsPosted}/${account.creditsPosted}) ` +
          `divergem da soma dos lancamentos (${want.dp}/${want.cp})`,
      });
    }
  }

  // 4. Nenhum lancamento com valor nao positivo.
  for (const entry of entries) {
    if (entry.amountCents <= 0n) {
      violations.push({
        invariant: 'entry_amount_positive',
        detail: `Lancamento ${entry.id} com valor ${entry.amountCents}`,
      });
    }
  }

  // 5. Nenhuma conta sem permissao esta negativa.
  for (const account of accounts) {
    if (account.allowsNegative) continue;
    const posted =
      account.normalBalance === 'CREDIT'
        ? account.creditsPosted - account.debitsPosted
        : account.debitsPosted - account.creditsPosted;
    if (posted < 0n) {
      violations.push({
        invariant: 'no_negative_balance',
        detail: `Conta ${account.code} com saldo postado ${posted}`,
      });
    }
  }

  return violations;
}

export function assertInvariants(
  accounts: readonly LedgerAccount[],
  entries: readonly LedgerEntry[],
): void {
  const violations = checkInvariants(accounts, entries);
  if (violations.length > 0) {
    throw new Error(
      `Invariantes do razao violadas:\n${violations.map((v) => `  [${v.invariant}] ${v.detail}`).join('\n')}`,
    );
  }
}
