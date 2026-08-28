import { LedgerAccountType, LedgerOwnerType, NORMAL_BALANCE_BY_TYPE } from './types.js';

/**
 * Plano de contas de um BaaS.
 *
 * Contas singleton do banco, mais duas contas por cliente. Duas e nao uma
 * porque bloqueio judicial e movimento real: precisa aparecer no extrato do
 * cliente e ser auditavel, o que um campo `blocked` na mesma conta nao da.
 */
export const LEDGER_CODES = {
  BACEN_RESERVE: '1000',
  SPI_IN_TRANSIT: '1100',
  SUSPENSE_CREDITS: '1900',
  /** Prefixo: a conta real e `2000.<accountId>`. */
  CUSTOMER_AVAILABLE: '2000',
  CUSTOMER_BLOCKED: '2100',
  PIX_OUT_CLEARING: '2200',
  RETURNS_PAYABLE: '2300',
  SUSPENSE_DEBITS: '2900',
  RETAINED_EARNINGS: '3000',
  FEE_REVENUE: '4000',
  OPERATING_EXPENSE: '5000',
  /**
   * Contraparte de tudo que sai ou entra do banco.
   *
   * Ter uma conta explicita para "todo mundo la fora" e o que mantem toda
   * transacao balanceada sem caso especial.
   */
  EXTERNAL_WORLD: '9000',
} as const;

export interface AccountTemplate {
  code: string;
  name: string;
  type: LedgerAccountType;
  ownerType: LedgerOwnerType;
  allowsNegative: boolean;
}

const template = (
  code: string,
  name: string,
  type: LedgerAccountType,
  ownerType: LedgerOwnerType,
  allowsNegative = false,
): AccountTemplate => ({ code, name, type, ownerType, allowsNegative });

export const SINGLETON_ACCOUNTS: readonly AccountTemplate[] = Object.freeze([
  template(
    LEDGER_CODES.BACEN_RESERVE,
    'Reserva no Banco Central',
    LedgerAccountType.ASSET,
    LedgerOwnerType.BANK,
  ),
  template(
    LEDGER_CODES.SPI_IN_TRANSIT,
    'Liquidacao SPI em transito',
    LedgerAccountType.ASSET,
    LedgerOwnerType.CLEARING,
  ),
  template(
    LEDGER_CODES.SUSPENSE_CREDITS,
    'Suspense: creditos nao identificados',
    LedgerAccountType.ASSET,
    LedgerOwnerType.INTERNAL,
  ),
  template(
    LEDGER_CODES.PIX_OUT_CLEARING,
    'Clearing de PIX out',
    LedgerAccountType.LIABILITY,
    LedgerOwnerType.CLEARING,
  ),
  template(
    LEDGER_CODES.RETURNS_PAYABLE,
    'Devolucoes a pagar',
    LedgerAccountType.LIABILITY,
    LedgerOwnerType.CLEARING,
  ),
  template(
    LEDGER_CODES.SUSPENSE_DEBITS,
    'Suspense: debitos nao identificados',
    LedgerAccountType.LIABILITY,
    LedgerOwnerType.INTERNAL,
  ),
  template(
    LEDGER_CODES.RETAINED_EARNINGS,
    'Lucros acumulados',
    LedgerAccountType.EQUITY,
    LedgerOwnerType.BANK,
  ),
  template(
    LEDGER_CODES.FEE_REVENUE,
    'Receita de tarifas',
    LedgerAccountType.REVENUE,
    LedgerOwnerType.BANK,
  ),
  template(
    LEDGER_CODES.OPERATING_EXPENSE,
    'Despesa operacional',
    LedgerAccountType.EXPENSE,
    LedgerOwnerType.BANK,
  ),
  // Contraparte externa: pode ficar em qualquer sinal, porque representa o
  // resto do sistema financeiro, nao um saldo nosso.
  template(
    LEDGER_CODES.EXTERNAL_WORLD,
    'Mundo externo (contraparte SPI)',
    LedgerAccountType.ASSET,
    LedgerOwnerType.EXTERNAL,
    true,
  ),
]);

export function customerAvailableCode(accountId: string): string {
  return `${LEDGER_CODES.CUSTOMER_AVAILABLE}.${accountId}`;
}

export function customerBlockedCode(accountId: string): string {
  return `${LEDGER_CODES.CUSTOMER_BLOCKED}.${accountId}`;
}

/** As duas contas de razao criadas junto com toda subconta de cliente. */
export function customerAccountTemplates(accountId: string): AccountTemplate[] {
  return [
    template(
      customerAvailableCode(accountId),
      `Subconta do cliente ${accountId}`,
      LedgerAccountType.LIABILITY,
      LedgerOwnerType.CUSTOMER,
    ),
    template(
      customerBlockedCode(accountId),
      `Fundos bloqueados do cliente ${accountId}`,
      LedgerAccountType.LIABILITY,
      LedgerOwnerType.CUSTOMER,
    ),
  ];
}

export function normalBalanceFor(type: LedgerAccountType) {
  return NORMAL_BALANCE_BY_TYPE[type];
}
