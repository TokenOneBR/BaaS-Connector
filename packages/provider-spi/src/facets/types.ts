import type {
  AccountStatus,
  HolderType,
  MoneyJSON,
  OnboardingDecision,
  OnboardingRejectionCode,
  OnboardingStatus,
  PixAccountType,
  PixChargeStatus,
  PixInitiationMethod,
  PixKeyType,
  PixPurpose,
  PixRefundReasonCode,
  RequirementCode,
  RequirementStatus,
  ScreeningResult,
  ScreeningType,
  StatementEntryType,
  TransactionStatus,
  TaxIdType,
} from '@baasconn/taxonomy';

export type PersonTypeLike = HolderType;
export type { MoneyJSON };

export type Timestamp = string;

export interface TaxIdInput {
  type: TaxIdType;
  value: string;
}

export interface PhoneInput {
  countryCode: string;
  areaCode: string;
  number: string;
}

export interface AddressInput {
  postalCode: string;
  street: string;
  number: string;
  complement?: string;
  district: string;
  city: string;
  state: string;
  country: 'BR';
  ibgeCityCode?: string;
}

export interface RepresentativeInput {
  role: string;
  taxId: TaxIdInput;
  fullName: string;
  birthDate: string;
  motherName?: string;
  email?: string;
  phone?: PhoneInput;
  ownershipPercentage?: string;
  isUltimateBeneficialOwner: boolean;
  isSigner: boolean;
  isPoliticallyExposed: boolean;
  address?: AddressInput;
}

export interface CreateAccountPFInput {
  /** Nosso id interno, ecoado para o provedor deduplicar do lado dele. */
  externalId: string;
  holder: {
    taxId: TaxIdInput;
    fullName: string;
    birthDate: string;
    motherName?: string;
    email: string;
    phone: PhoneInput;
    addresses: AddressInput[];
    monthlyIncome?: MoneyJSON;
    isPoliticallyExposed: boolean;
  };
  metadata?: Record<string, string>;
}

export interface CreateAccountPJInput {
  externalId: string;
  company: {
    taxId: TaxIdInput;
    legalName: string;
    tradeName?: string;
    incorporationDate: string;
    mainCnae?: string;
    legalNatureCode?: string;
    monthlyRevenue?: MoneyJSON;
    shareCapital?: MoneyJSON;
    email: string;
    phone: PhoneInput;
    addresses: AddressInput[];
  };
  representatives: RepresentativeInput[];
  metadata?: Record<string, string>;
}

export interface ProviderAccount {
  providerAccountId: string;
  status: AccountStatus;
  personType: HolderType;
  bank?: {
    ispb: string;
    bankCode?: string;
    branch: string;
    branchCheckDigit?: string;
    number: string;
    checkDigit?: string;
  };
  openedAt?: Timestamp;
  /** Payload do provedor, ja redigido, mantido para auditoria e depuracao. */
  raw?: unknown;
}

export interface ProviderBalance {
  available: MoneyJSON;
  blocked?: MoneyJSON;
  pending?: MoneyJSON;
  /** Instante do provedor, quando ele expoe um. Senao, o da resposta. */
  asOf: Timestamp;
  raw?: unknown;
}

export interface PendingRequirement {
  code: RequirementCode;
  providerCode?: string;
  description: string;
  /** Em KYB: de qual representante a pendencia trata. */
  subjectTaxId?: TaxIdInput;
  status: RequirementStatus;
  dueAt?: Timestamp;
}

export interface OnboardingCase {
  providerCaseId: string;
  status: OnboardingStatus;
  decision?: {
    outcome: OnboardingDecision;
    reasonCode?: OnboardingRejectionCode;
    providerReasonCode?: string;
    reason?: string;
  };
  riskScore?: string;
  /**
   * Conjunto COMPLETO de pendencias no momento, nao um delta.
   *
   * O core faz set-diff contra o que ja tinha. Sem isso a lista vira
   * append-only e nunca limpa, que e a falha classica de integracao de KYC.
   */
  pendingRequirements: PendingRequirement[];
  updatedAt: Timestamp;
  raw?: unknown;
}

export interface DocumentUpload {
  kind: RequirementCode;
  side?: string;
  subjectTaxId?: TaxIdInput;
  filename: string;
  contentType: string;
  /** Stream, nunca base64 bufferizado: documento de KYC passa de 20 MB. */
  content: () => NodeJS.ReadableStream;
  sizeBytes: number;
  sha256: string;
}

export interface DocumentReceipt {
  providerDocumentId: string;
  acceptedAt: Timestamp;
}

export interface PldScreeningInput {
  subjectTaxId: TaxIdInput;
  subjectName: string;
  types: ScreeningType[];
}

export interface PldScreeningResult {
  providerScreeningId?: string;
  results: Array<{
    type: ScreeningType;
    result: ScreeningResult;
    score?: string;
    matches: Array<{ listName: string; matchedName: string; similarity?: string }>;
  }>;
  screenedAt: Timestamp;
}

export interface PixKey {
  providerKeyId?: string;
  type: PixKeyType;
  value: string;
  status: string;
  requestedAt?: Timestamp;
  activatedAt?: Timestamp;
  raw?: unknown;
}

export interface PixKeyResolution {
  key: string;
  keyType: PixKeyType;
  holderName: string;
  holderTaxId: TaxIdInput;
  ispb: string;
  bankName?: string;
  branch?: string;
  accountNumber?: string;
  accountType?: PixAccountType;
  raw?: unknown;
}

export interface CreateStaticChargeInput {
  pixKey: string;
  amount?: MoneyJSON;
  txid?: string;
  payerRequest?: string;
  merchantName: string;
  merchantCity: string;
}

export interface CreateDynamicChargeInput extends CreateStaticChargeInput {
  expiresInSeconds?: number;
  dueDate?: string;
  validAfterDueDays?: number;
  amountIsChangeable?: boolean;
  payer?: { taxId: TaxIdInput; name: string };
  fine?: { mode: string; value: string };
  interest?: { mode: string; value: string };
  discounts?: Array<{ mode: string; value: string; date?: string }>;
  additionalInfo?: Array<{ name: string; value: string }>;
}

export interface PixCharge {
  txid: string;
  kind: 'static' | 'dynamic';
  status: PixChargeStatus;
  amount?: MoneyJSON;
  /** Copia e cola (BR Code / EMV MPM). */
  emvPayload: string;
  qrCodeImageUrl?: string;
  locationUrl?: string;
  revision?: number;
  expiresAt?: Timestamp;
  paidAmount?: MoneyJSON;
  paidAt?: Timestamp;
  raw?: unknown;
}

export type PixDestination =
  | { kind: 'pix_key'; key: string; keyType?: PixKeyType }
  | {
      kind: 'bank_account';
      ispb: string;
      branch: string;
      number: string;
      checkDigit?: string;
      accountType: PixAccountType;
      holder: { taxId: TaxIdInput; name: string };
    }
  | { kind: 'emv'; payload: string }
  | { kind: 'qr_code'; txid: string; emv: string };

export interface SendPixInput {
  /** Deterministica e estavel entre os nossos retries. */
  idempotencyKey: string;
  /** Presente apenas quando nos cunhamos o E2EID (Mock Bank). */
  endToEndId?: string;
  amount: MoneyJSON;
  destination: PixDestination;
  description?: string;
  purpose: PixPurpose;
  initiationMethod?: PixInitiationMethod;
  scheduledFor?: string;
  metadata?: Record<string, string>;
}

export interface Counterparty {
  name?: string;
  taxId?: TaxIdInput;
  ispb?: string;
  bankName?: string;
  branch?: string;
  accountNumber?: string;
  accountType?: PixAccountType;
}

export interface PixTransaction {
  providerTransactionId: string;
  /**
   * Nulo ate PROCESSING, muitas vezes ate SETTLED: e gerado pelo PSP do
   * pagador. Assumir que existe na criacao e a pegadinha classica.
   */
  endToEndId?: string;
  status: TransactionStatus;
  direction: 'in' | 'out';
  amount: MoneyJSON;
  fee?: MoneyJSON;
  counterparty?: Counterparty;
  txid?: string;
  createdAt: Timestamp;
  settledAt?: Timestamp;
  failure?: { code: string; message: string };
  raw?: unknown;
}

export interface CreateRefundInput {
  idempotencyKey: string;
  originalEndToEndId: string;
  originalProviderTransactionId?: string;
  amount?: MoneyJSON;
  reasonCode: PixRefundReasonCode;
  description?: string;
}

export interface PixRefund {
  providerRefundId: string;
  returnId?: string;
  originalEndToEndId: string;
  status: TransactionStatus;
  amount: MoneyJSON;
  createdAt: Timestamp;
  settledAt?: Timestamp;
  raw?: unknown;
}

export interface StatementQuery {
  from: string;
  to: string;
}

export interface StatementEntry {
  providerEntryId: string;
  postedAt: Timestamp;
  /** Dia bancario brasileiro, nao UTC. */
  effectiveDate: string;
  direction: 'credit' | 'debit';
  amount: MoneyJSON;
  balanceAfter?: MoneyJSON;
  type: StatementEntryType;
  endToEndId?: string;
  providerTransactionId?: string;
  counterparty?: Counterparty;
  description?: string;
  raw?: unknown;
}
