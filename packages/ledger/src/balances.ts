import { NormalBalance, type Balances, type LedgerAccount } from './types.js';

/**
 * Saldos derivados dos quatro contadores.
 *
 * A formula depende do `normalBalance`, e essa e a unica implementacao dela em
 * todo o projeto. Inlinar esse calculo em outro lugar e como os sinais passam
 * a divergir entre a API, o extrato e a conciliacao.
 */
export function computeBalances(account: LedgerAccount): Balances {
  const { debitsPosted, creditsPosted, debitsPending, creditsPending } = account;

  if (account.normalBalance === NormalBalance.CREDIT) {
    const posted = creditsPosted - debitsPosted;
    return {
      posted,
      // Debitos pendentes ja estao reservados e nao podem ser gastos de novo.
      available: posted - debitsPending,
      pending: creditsPending,
    };
  }

  const posted = debitsPosted - creditsPosted;
  return {
    posted,
    available: posted - creditsPending,
    pending: debitsPending,
  };
}

/**
 * Verifica a invariante de saldo nao negativo.
 *
 * No banco isto e um CHECK constraint, que e o que de fato garante a
 * propriedade: checagem em aplicacao e corrida, um CHECK numa linha cujo lock
 * ja detemos nao e. Esta funcao existe para o motor em memoria e para dar
 * mensagem util antes de o banco recusar.
 */
export function violatesOverdraftGuard(account: LedgerAccount): boolean {
  if (account.allowsNegative) return false;
  return computeBalances(account).available < 0n;
}
