import {
  AccountStatus,
  HolderType,
  OnboardingStatus,
  PixChargeStatus,
  PixKeyStatus,
  PixKeyType,
  TransactionStatus,
  RequirementCode,
  ScreeningType,
} from '@baasconn/taxonomy';
import { Injectable } from '@nestjs/common';

export interface MockAccount {
  id: string;
  clientId: string;
  holderType: HolderType;
  holderTaxId: string;
  holderName: string;
  email: string;
  status: AccountStatus;
  branch: string;
  number: string;
  checkDigit: string;
  ispb: string;
  externalId?: string;
  /** Ids das contas de razao: disponivel e bloqueada. */
  availableLedgerAccountId: string;
  blockedLedgerAccountId: string;
  onboardingId?: string;
  createdAt: Date;
  openedAt?: Date;
  raw: Record<string, unknown>;
}

export interface MockRequirement {
  code: RequirementCode;
  status: 'PENDING' | 'SUBMITTED' | 'ACCEPTED' | 'REJECTED';
  documentId?: string;
}

export interface MockDocument {
  id: string;
  onboardingId: string;
  code: RequirementCode;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  uploadedAt: Date;
}

export interface MockOnboarding {
  id: string;
  accountId: string;
  type: 'KYC' | 'KYB';
  status: OnboardingStatus;
  requirements: MockRequirement[];
  screenings: Array<{ type: ScreeningType; result: 'CLEAR' | 'MATCH' }>;
  rejectionCode?: string;
  rejectionMessage?: string;
  scenario: string;
  submittedAt?: Date;
  decidedAt?: Date;
  expiresAt?: Date;
  updatedAt: Date;
}

export interface MockPixKey {
  id: string;
  accountId: string;
  type: PixKeyType;
  value: string;
  status: PixKeyStatus;
  createdAt: Date;
}

export interface MockCharge {
  txid: string;
  accountId: string;
  kind: 'static' | 'dynamic';
  status: PixChargeStatus;
  amountCents?: bigint;
  pixKey: string;
  emvPayload: string;
  expiresAt?: Date;
  paidAmountCents: bigint;
  paidAt?: Date;
  paidTransactionIds: string[];
  revision: number;
  createdAt: Date;
}

export interface MockPayment {
  id: string;
  accountId: string;
  direction: 'in' | 'out';
  status: TransactionStatus;
  amountCents: bigint;
  feeCents: bigint;
  endToEndId?: string;
  returnId?: string;
  originalEndToEndId?: string;
  txid?: string;
  idempotencyKey?: string;
  counterparty: {
    name?: string;
    taxId?: string;
    ispb?: string;
    branch?: string;
    accountNumber?: string;
    pixKey?: string;
  };
  description?: string;
  scenario: string;
  refundedCents: bigint;
  ledgerPendingTransactionId?: string;
  ledgerPostedTransactionId?: string;
  createdAt: Date;
  settledAt?: Date;
  failedAt?: Date;
  failureCode?: string;
}

export interface FaultConfig {
  latencyMs: number;
  errorRate: number;
  forceStatus?: number;
  duplicateWebhooks: boolean;
  reorderWebhooks: boolean;
  invalidSignature: boolean;
}

export const DEFAULT_FAULTS: FaultConfig = Object.freeze({
  latencyMs: 0,
  errorRate: 0,
  duplicateWebhooks: false,
  reorderWebhooks: false,
  invalidSignature: false,
});

/**
 * Estado do Mock Bank.
 *
 * `MOCK_BANK_STORE=memory` (padrao em teste) usa isto direto; o modo
 * `postgres` usa a mesma interface com repositorios Prisma. Manter a interface
 * unica e o que permite a suite de conformidade rodar in-process em ~50ms e a
 * e2e rodar contra o servico containerizado, com o mesmo codigo.
 */
@Injectable()
export class MockBankStore {
  readonly accounts = new Map<string, MockAccount>();
  readonly accountsByTaxId = new Map<string, string>();
  readonly accountsByExternalId = new Map<string, string>();
  readonly onboardings = new Map<string, MockOnboarding>();
  readonly documents = new Map<string, MockDocument>();
  readonly pixKeys = new Map<string, MockPixKey>();
  readonly pixKeysByValue = new Map<string, string>();
  readonly charges = new Map<string, MockCharge>();
  readonly payments = new Map<string, MockPayment>();
  readonly paymentsByIdempotencyKey = new Map<string, string>();
  readonly paymentsByEndToEndId = new Map<string, string>();
  readonly webhookUrls = new Map<string, string>();

  faults: FaultConfig = { ...DEFAULT_FAULTS };

  reset(): void {
    this.accounts.clear();
    this.accountsByTaxId.clear();
    this.accountsByExternalId.clear();
    this.onboardings.clear();
    this.documents.clear();
    this.pixKeys.clear();
    this.pixKeysByValue.clear();
    this.charges.clear();
    this.payments.clear();
    this.paymentsByIdempotencyKey.clear();
    this.paymentsByEndToEndId.clear();
    this.faults = { ...DEFAULT_FAULTS };
  }
}
