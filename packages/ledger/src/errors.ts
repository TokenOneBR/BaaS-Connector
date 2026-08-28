import { BaasError, BaasErrorCode } from '@baasconn/taxonomy';

export class LedgerUnbalancedError extends BaasError {
  constructor(debits: bigint, credits: bigint) {
    super(BaasErrorCode.LEDGER_UNBALANCED, {
      message: `Transacao desbalanceada: debitos ${debits} e creditos ${credits}`,
      meta: { debits: debits.toString(), credits: credits.toString() },
    });
    this.name = 'LedgerUnbalancedError';
  }
}

export class InsufficientFundsError extends BaasError {
  constructor(
    readonly accountId: string,
    readonly requested: bigint,
    readonly available: bigint,
  ) {
    super(BaasErrorCode.INSUFFICIENT_FUNDS, {
      message: `Saldo insuficiente na conta ${accountId}: pedido ${requested}, disponivel ${available}`,
      meta: {
        accountId,
        requestedCents: requested.toString(),
        availableCents: available.toString(),
      },
    });
    this.name = 'InsufficientFundsError';
  }
}

export class LedgerValidationError extends BaasError {
  constructor(message: string) {
    super(BaasErrorCode.VALIDATION_ERROR, { message });
    this.name = 'LedgerValidationError';
  }
}
