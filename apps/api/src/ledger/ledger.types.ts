import type { LedgerEngine, LedgerEntry, LedgerStore } from '@baasconn/ledger';
import type { Environment } from '@baasconn/taxonomy';

export const LEDGER_STORE_FACTORY = Symbol('BAAS_LEDGER_STORE_FACTORY');

/**
 * Store do razao com o que o conector precisa alem do port do motor.
 *
 * O port de `packages/ledger` tem cinco metodos e e o que o MOTOR usa. Estes
 * tres extras sao do conector: abrir contas de cliente, achar uma conta pelo
 * codigo e ler lancamentos numa janela. Mante-los fora do port do motor e
 * deliberado — o motor nao precisa saber que existe extrato.
 */
export interface ConnectorLedgerStore extends LedgerStore {
  readonly engine: LedgerEngine;
  /** Serializa o trabalho. Em memoria e uma fila; no Postgres, a transacao. */
  runExclusive<T>(fn: () => Promise<T>): Promise<T>;
  ensureAccounts(
    templates: readonly {
      code: string;
      name: string;
      type: string;
      ownerType: string;
      allowsNegative: boolean;
      ownerId?: string;
    }[],
    newAccountId: () => string,
  ): Promise<Map<string, string>>;
  accountIdByCode(code: string): Promise<string | undefined>;
  entriesInWindow(ledgerAccountId: string, from: Date, to: Date): Promise<LedgerEntry[]>;
}

/**
 * Um store por ambiente.
 *
 * Homologacao e producao tem razoes SEPARADOS. Um store compartilhado com
 * filtro por coluna seria uma consulta esquecida longe de misturar saldo de
 * teste com saldo real.
 */
export interface LedgerStoreFactory {
  for(environment: Environment): ConnectorLedgerStore;
}
