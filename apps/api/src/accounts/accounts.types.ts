import type {
  AccountKind,
  AccountStatus,
  Environment,
  HolderType,
  OnboardingStatus,
  OnboardingType,
  RequirementCode,
  RequirementStatus,
  TaxIdType,
} from '@baasconn/taxonomy';

/**
 * Titular gravado.
 *
 * O documento NAO aparece aqui em claro: fica cifrado em envelope na tabela, e
 * o que o dominio manipula e o indice cego (para achar) mais os quatro ultimos
 * digitos (para o suporte confirmar com o cliente ao telefone).
 */
export interface HolderRecord {
  id: string;
  environment: Environment;
  type: HolderType;
  taxIdType: TaxIdType;
  taxIdBlindIndex: string;
  taxIdLast4: string;
  legalName: string;
  email: string;
  externalId?: string | null;
  createdAt: Date;
}

export interface AccountRecord {
  id: string;
  environment: Environment;
  holderId: string;
  provider: string;
  providerConnectionId: string;
  providerAccountId?: string | null;
  externalId?: string | null;
  status: AccountStatus;
  statusReasonCode?: string | null;
  statusReasonMessage?: string | null;
  statusChangedAt?: Date | null;
  /** Instante do ultimo evento aplicado. Base do guard monotonico. */
  lastEventAt?: Date | null;
  kind: AccountKind;
  currency: string;
  /** Contas do razao sombra. As colunas ja existiam; o M6 passa a usa-las. */
  ledgerAvailableAccountId?: string | null;
  ledgerBlockedAccountId?: string | null;
  ispb?: string | null;
  branch?: string | null;
  number?: string | null;
  checkDigit?: string | null;
  openedAt?: Date | null;
  closedAt?: Date | null;
  metadata: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

export interface OnboardingRecord {
  id: string;
  environment: Environment;
  holderId: string;
  accountId?: string | null;
  provider: string;
  providerCaseId?: string | null;
  type: OnboardingType;
  status: OnboardingStatus;
  lastEventAt?: Date | null;
  rejectionCode?: string | null;
  rejectionMessage?: string | null;
  providerRejectionCode?: string | null;
  submittedAt?: Date | null;
  decidedAt?: Date | null;
  requirements: RequirementRecord[];
  createdAt: Date;
  updatedAt: Date;
}

export interface RequirementRecord {
  id: string;
  caseId: string;
  code: RequirementCode;
  status: RequirementStatus;
  label: string;
  documentId?: string | null;
  attempts: number;
}

/**
 * Motivo de uma mudanca nao aplicada.
 *
 * A distincao importa: `stale_*` e `same_state` sao reentrega ou evento fora
 * de ordem — comportamento normal de provedor, vira DISCARDED com registro.
 * `illegal_transition` e o provedor contradizendo a maquina de estados, e vira
 * anomalia auditada e alertavel.
 */
export type StatusChangeRejection =
  'stale_rank' | 'stale_timestamp' | 'same_state' | 'illegal_transition' | 'not_found';

export interface StatusChangeResult<T> {
  applied: boolean;
  reason?: StatusChangeRejection;
  /** Estado atual quando a mudanca foi recusada, para a linha de anomalia. */
  currentStatus?: string;
  record?: T;
}

export const HOLDER_REPOSITORY = Symbol('BAAS_HOLDER_REPOSITORY');
export const ACCOUNT_REPOSITORY = Symbol('BAAS_ACCOUNT_REPOSITORY');
export const ONBOARDING_REPOSITORY = Symbol('BAAS_ONBOARDING_REPOSITORY');

export interface HolderRepository {
  /** Busca pelo indice cego: e o que torna "achar o titular do CPF X" possivel. */
  findByTaxIdBlindIndex(
    environment: Environment,
    blindIndex: string,
  ): Promise<HolderRecord | undefined>;
  findById(environment: Environment, id: string): Promise<HolderRecord | undefined>;
  /** Envelope cru para decifrar sob `pii:read`. Devolve undefined se nao houver. */
  taxIdEnvelope(
    environment: Environment,
    id: string,
  ): Promise<
    | {
        ciphertext: Buffer;
        iv: Buffer;
        authTag: Buffer;
        wrappedKey: Buffer;
        keyId: string;
        version: number;
      }
    | undefined
  >;
  create(input: {
    record: Omit<HolderRecord, 'createdAt'>;
    /** Envelope do documento. O plaintext nunca chega ao repositorio. */
    taxIdEnvelope: {
      ciphertext: Buffer;
      iv: Buffer;
      authTag: Buffer;
      wrappedKey: Buffer;
      keyId: string;
    };
    emailBlindIndex: string;
    phone: { countryCode: string; areaCode: string; number: string };
  }): Promise<HolderRecord>;
}

export interface ListAccountsFilter {
  environment: Environment;
  /** A conciliacao roda por conexao: sem isto, traria todas e descartaria. */
  connectionId?: string;
  status?: AccountStatus;
  holderType?: HolderType;
  externalId?: string;
  limit: number;
  cursor?: string;
}

export interface AccountRepository {
  findById(environment: Environment, id: string): Promise<AccountRecord | undefined>;
  findByExternalId(
    environment: Environment,
    externalId: string,
  ): Promise<AccountRecord | undefined>;
  findByProviderAccountId(
    environment: Environment,
    provider: string,
    providerAccountId: string,
  ): Promise<AccountRecord | undefined>;
  list(filter: ListAccountsFilter): Promise<{ data: AccountRecord[]; nextCursor?: string }>;
  create(record: AccountRecord): Promise<AccountRecord>;
  /**
   * Aplica uma mudanca de status sob lock.
   *
   * O guard monotonico e a checagem de legalidade rodam AQUI, dentro da mesma
   * transacao que trava a linha. Decidir no servico e depois gravar seria uma
   * corrida: entre a leitura e a escrita, uma requisicao da API pode ter mudado
   * o status, e o evento velho sobrescreveria o novo.
   *
   * `applied: false` vem com o motivo, e os motivos NAO sao equivalentes: um
   * evento velho e descarte esperado, uma transicao ilegal e anomalia.
   */
  applyStatusChange(input: {
    environment: Environment;
    accountId: string;
    toStatus: AccountStatus;
    reasonCode?: string;
    reasonMessage?: string;
    occurredAt: Date;
    source: string;
    providerEventId?: string;
    /** Executado dentro da MESMA transacao da mudanca. */
    withinTransaction?: (accountId: string) => Promise<void>;
  }): Promise<StatusChangeResult<AccountRecord>>;
  /** Liga o par de contas do razao a conta. Chamado uma vez, na abertura. */
  attachLedgerAccounts(input: {
    environment: Environment;
    accountId: string;
    availableId: string;
    blockedId: string;
  }): Promise<AccountRecord>;
  attachProviderAccount(input: {
    environment: Environment;
    accountId: string;
    providerAccountId: string;
    status: AccountStatus;
    bank?: { ispb?: string; branch?: string; number?: string; checkDigit?: string };
    openedAt?: Date;
  }): Promise<AccountRecord>;
}

export interface OnboardingRepository {
  findById(environment: Environment, id: string): Promise<OnboardingRecord | undefined>;
  findByAccountId(
    environment: Environment,
    accountId: string,
  ): Promise<OnboardingRecord | undefined>;
  findByProviderCaseId(
    environment: Environment,
    provider: string,
    providerCaseId: string,
  ): Promise<OnboardingRecord | undefined>;
  create(record: OnboardingRecord): Promise<OnboardingRecord>;
  applyStatusChange(input: {
    environment: Environment;
    caseId: string;
    toStatus: OnboardingStatus;
    rejectionCode?: string;
    rejectionMessage?: string;
    providerRejectionCode?: string;
    /** Conjunto COMPLETO de pendencias; o repositorio faz o set-diff. */
    requirements?: Array<{ code: RequirementCode; label: string }>;
    occurredAt: Date;
    withinTransaction?: (caseId: string) => Promise<void>;
  }): Promise<StatusChangeResult<OnboardingRecord>>;
}
