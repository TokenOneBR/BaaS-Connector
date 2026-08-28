-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('DRAFT', 'PENDING_ONBOARDING', 'PENDING_DOCUMENTS', 'UNDER_REVIEW', 'ACTIVE', 'BLOCKED', 'SUSPENDED', 'REJECTED', 'CLOSING', 'CLOSED');

-- CreateEnum
CREATE TYPE "AccountKind" AS ENUM ('PAYMENT', 'CHECKING', 'SAVINGS', 'ESCROW');

-- CreateEnum
CREATE TYPE "Environment" AS ENUM ('HOMOLOGACAO', 'PRODUCAO');

-- CreateEnum
CREATE TYPE "ProviderSlug" AS ENUM ('CELCOIN', 'QITECH', 'DOCK', 'ASAAS', 'WOOVI', 'MOCK_BANK');

-- CreateEnum
CREATE TYPE "HolderType" AS ENUM ('INDIVIDUAL', 'BUSINESS');

-- CreateEnum
CREATE TYPE "TaxIdType" AS ENUM ('CPF', 'CNPJ');

-- CreateEnum
CREATE TYPE "RiskRating" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'PROHIBITED');

-- CreateEnum
CREATE TYPE "BrazilianState" AS ENUM ('AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO');

-- CreateEnum
CREATE TYPE "AddressType" AS ENUM ('RESIDENTIAL', 'COMMERCIAL', 'MAILING');

-- CreateEnum
CREATE TYPE "MaritalStatus" AS ENUM ('SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'STABLE_UNION');

-- CreateEnum
CREATE TYPE "IdentityDocumentKind" AS ENUM ('RG', 'CNH', 'RNE', 'PASSPORT', 'CTPS');

-- CreateEnum
CREATE TYPE "CompanySize" AS ENUM ('MEI', 'ME', 'EPP', 'MEDIUM', 'LARGE');

-- CreateEnum
CREATE TYPE "RepresentativeRole" AS ENUM ('PARTNER', 'ADMINISTRATOR', 'DIRECTOR', 'ATTORNEY', 'LEGAL_GUARDIAN');

-- CreateEnum
CREATE TYPE "ChangeSource" AS ENUM ('API', 'PROVIDER_WEBHOOK', 'POLLING', 'RECONCILIATION', 'MANUAL', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('API_KEY', 'USER', 'SYSTEM', 'PROVIDER');

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "NormalBalance" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "LedgerOwnerType" AS ENUM ('BANK', 'CUSTOMER', 'CLEARING', 'INTERNAL', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "LedgerAccountStatus" AS ENUM ('OPEN', 'FROZEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "EntryDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "EntryPhase" AS ENUM ('PENDING', 'POSTED', 'VOID');

-- CreateEnum
CREATE TYPE "LedgerTransactionStatus" AS ENUM ('PENDING', 'POSTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "OnboardingType" AS ENUM ('KYC', 'KYB');

-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PENDING_REQUIREMENTS', 'IN_ANALYSIS', 'MANUAL_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OnboardingDecision" AS ENUM ('APPROVE', 'REJECT', 'REVIEW');

-- CreateEnum
CREATE TYPE "OnboardingRejectionCode" AS ENUM ('DOCUMENT_ILLEGIBLE', 'DOCUMENT_EXPIRED', 'DOCUMENT_TAMPERED', 'FACE_MATCH_FAILED', 'LIVENESS_FAILED', 'DATA_MISMATCH', 'TAX_ID_IRREGULAR', 'UNDERAGE', 'SANCTIONS_MATCH', 'PEP_RESTRICTED', 'ADVERSE_MEDIA', 'PROHIBITED_ACTIVITY', 'FRAUD_SUSPICION', 'DUPLICATE_HOLDER', 'UBO_NOT_IDENTIFIED', 'RISK_APPETITE', 'PROVIDER_POLICY');

-- CreateEnum
CREATE TYPE "RequirementCode" AS ENUM ('SELFIE_LIVENESS', 'IDENTITY_FRONT', 'IDENTITY_BACK', 'PROOF_OF_ADDRESS', 'PROOF_OF_INCOME', 'TAX_ID_DOCUMENT', 'ARTICLES_OF_INCORPORATION', 'LATEST_AMENDMENT', 'BOARD_ELECTION_MINUTES', 'CNPJ_REGISTRATION_CARD', 'OWNERSHIP_CHART', 'UBO_DECLARATION', 'FINANCIAL_STATEMENTS', 'POWER_OF_ATTORNEY', 'REPRESENTATIVE_KYC', 'ADDITIONAL_INFORMATION', 'PHONE_VERIFICATION', 'EMAIL_VERIFICATION', 'TERMS_ACCEPTANCE');

-- CreateEnum
CREATE TYPE "RequirementStatus" AS ENUM ('PENDING', 'SUBMITTED', 'IN_ANALYSIS', 'ACCEPTED', 'REJECTED', 'WAIVED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "DocumentSide" AS ENUM ('FRONT', 'BACK', 'SINGLE');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADED', 'SENT_TO_PROVIDER', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ScreeningType" AS ENUM ('PEP', 'SANCTIONS', 'DOMESTIC_RESTRICTIVE', 'ADVERSE_MEDIA', 'INTERNAL_DENYLIST', 'TAX_ID_STATUS', 'CREDIT_BUREAU', 'DEVICE_FRAUD');

-- CreateEnum
CREATE TYPE "ScreeningResult" AS ENUM ('CLEAR', 'POTENTIAL_MATCH', 'MATCH', 'INCONCLUSIVE', 'ERROR');

-- CreateEnum
CREATE TYPE "IdempotencyState" AS ENUM ('IN_FLIGHT', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "OperationStatus" AS ENUM ('PENDING', 'SUBMITTED', 'UNKNOWN', 'SETTLED', 'FAILED');

-- CreateEnum
CREATE TYPE "InboundEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'DISCARDED', 'FAILED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DISABLED_BY_FAILURES');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'EXHAUSTED');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');

-- CreateEnum
CREATE TYPE "PixKeyType" AS ENUM ('CPF', 'CNPJ', 'EMAIL', 'PHONE', 'EVP');

-- CreateEnum
CREATE TYPE "PixKeyStatus" AS ENUM ('PENDING_REGISTRATION', 'PENDING_OWNERSHIP_CONFIRMATION', 'ACTIVE', 'PENDING_PORTABILITY_IN', 'PENDING_PORTABILITY_OUT', 'PENDING_CLAIM_IN', 'PENDING_CLAIM_OUT', 'REMOVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PixClaimType" AS ENUM ('PORTABILITY', 'OWNERSHIP');

-- CreateEnum
CREATE TYPE "PixChargeKind" AS ENUM ('STATIC', 'DYNAMIC_IMMEDIATE', 'DYNAMIC_DUE');

-- CreateEnum
CREATE TYPE "PixChargeStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'EXPIRED', 'REMOVED_BY_PSP', 'REMOVED_BY_USER');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('PENDING_VALIDATION', 'ACTIVE', 'DEGRADED', 'DISABLED', 'INVALID_CREDENTIALS');

-- CreateEnum
CREATE TYPE "ApiKeyStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ConsoleRole" AS ENUM ('OWNER', 'ADMIN', 'OPERATOR', 'VIEWER', 'COMPLIANCE');

-- CreateEnum
CREATE TYPE "ReconciliationScope" AS ENUM ('DAILY', 'INTRADAY', 'BACKFILL', 'MANUAL');

-- CreateEnum
CREATE TYPE "ReconciliationRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'COMPLETED_WITH_BREAKS', 'FAILED');

-- CreateEnum
CREATE TYPE "ReconciliationSide" AS ENUM ('PROVIDER', 'LOCAL', 'LEDGER');

-- CreateEnum
CREATE TYPE "BreakType" AS ENUM ('MISSING_ON_LOCAL', 'MISSING_ON_PROVIDER', 'MISSING_ON_LEDGER', 'AMOUNT_MISMATCH', 'STATUS_MISMATCH', 'DUPLICATE_LOCAL', 'DUPLICATE_PROVIDER', 'DATE_MISMATCH', 'BALANCE_MISMATCH', 'UNMATCHED_FEE', 'ORPHAN_REFUND');

-- CreateEnum
CREATE TYPE "BreakSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "BreakStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'RESOLVED', 'WRITTEN_OFF', 'AUTO_RESOLVED');

-- CreateEnum
CREATE TYPE "ResolutionAction" AS ENUM ('IMPORT_FROM_PROVIDER', 'MARK_PROVIDER_AUTHORITATIVE', 'CREATE_LEDGER_ADJUSTMENT', 'CANCEL_LOCAL_RECORD', 'MERGE_DUPLICATE', 'IGNORE_TIMING_DIFFERENCE', 'WRITE_OFF', 'ESCALATE_TO_PROVIDER');

-- CreateEnum
CREATE TYPE "MatchConfidence" AS ENUM ('EXACT', 'HIGH', 'LOW');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('PIX_IN', 'PIX_OUT', 'PIX_REFUND_IN', 'PIX_REFUND_OUT', 'INTERNAL_TRANSFER_IN', 'INTERNAL_TRANSFER_OUT', 'FEE', 'FEE_REVERSAL', 'ADJUSTMENT_CREDIT', 'ADJUSTMENT_DEBIT', 'BLOCK', 'UNBLOCK');

-- CreateEnum
CREATE TYPE "TransactionDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('CREATED', 'PENDING', 'PROCESSING', 'SETTLED', 'FAILED', 'CANCELLED', 'REVERSED', 'PARTIALLY_REVERSED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PixInitiationMethod" AS ENUM ('MANUAL', 'KEY', 'STATIC_QRCODE', 'DYNAMIC_QRCODE', 'COPY_PASTE', 'PAYMENT_INITIATOR');

-- CreateEnum
CREATE TYPE "PixPurpose" AS ENUM ('TRANSFER', 'PURCHASE', 'WITHDRAWAL', 'CHANGE');

-- CreateEnum
CREATE TYPE "PixAccountType" AS ENUM ('CHECKING', 'SAVINGS', 'PAYMENT', 'SALARY');

-- CreateEnum
CREATE TYPE "PixRefundReasonCode" AS ENUM ('FRAUD', 'OPERATIONAL_ERROR', 'REQUESTED_BY_PAYER', 'MERCHANT_REFUND', 'SETTLEMENT_FAILURE', 'ACCOUNT_CLOSED');

-- CreateTable
CREATE TABLE "account" (
    "id" VARCHAR(40) NOT NULL,
    "environment" "Environment" NOT NULL,
    "holder_id" VARCHAR(40) NOT NULL,
    "provider" "ProviderSlug" NOT NULL,
    "provider_connection_id" VARCHAR(40) NOT NULL,
    "provider_account_id" VARCHAR(128),
    "external_id" VARCHAR(128),
    "status" "AccountStatus" NOT NULL DEFAULT 'DRAFT',
    "status_reason_code" VARCHAR(64),
    "status_reason_message" VARCHAR(512),
    "status_changed_at" TIMESTAMPTZ(6),
    "last_event_at" TIMESTAMPTZ(6),
    "kind" "AccountKind" NOT NULL DEFAULT 'PAYMENT',
    "currency" VARCHAR(3) NOT NULL DEFAULT 'BRL',
    "ispb" VARCHAR(8),
    "bank_code" VARCHAR(3),
    "branch" VARCHAR(4),
    "branch_check_digit" VARCHAR(1),
    "number" VARCHAR(20),
    "check_digit" VARCHAR(2),
    "ledger_available_account_id" VARCHAR(40),
    "ledger_blocked_account_id" VARCHAR(40),
    "opened_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_status_change" (
    "id" VARCHAR(40) NOT NULL,
    "account_id" VARCHAR(40) NOT NULL,
    "from_status" "AccountStatus",
    "to_status" "AccountStatus" NOT NULL,
    "reason_code" VARCHAR(64),
    "reason_message" VARCHAR(512),
    "source" "ChangeSource" NOT NULL,
    "provider_event_id" VARCHAR(40),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_status_change_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_balance" (
    "account_id" VARCHAR(40) NOT NULL,
    "environment" "Environment" NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'BRL',
    "available_cents" BIGINT NOT NULL DEFAULT 0,
    "blocked_cents" BIGINT NOT NULL DEFAULT 0,
    "pending_cents" BIGINT NOT NULL DEFAULT 0,
    "scheduled_out_cents" BIGINT NOT NULL DEFAULT 0,
    "provider_as_of" TIMESTAMPTZ(6),
    "fetched_at" TIMESTAMPTZ(6) NOT NULL,
    "stale_after" TIMESTAMPTZ(6) NOT NULL,
    "last_known_movement_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "account_balance_pkey" PRIMARY KEY ("account_id")
);

-- CreateTable
CREATE TABLE "account_holder" (
    "id" VARCHAR(40) NOT NULL,
    "environment" "Environment" NOT NULL,
    "type" "HolderType" NOT NULL,
    "tax_id_type" "TaxIdType" NOT NULL,
    "tax_id_ciphertext" BYTEA NOT NULL,
    "tax_id_iv" BYTEA NOT NULL,
    "tax_id_tag" BYTEA NOT NULL,
    "tax_id_wrapped_key" BYTEA NOT NULL,
    "tax_id_key_id" VARCHAR(255) NOT NULL,
    "tax_id_blind_index" VARCHAR(64) NOT NULL,
    "tax_id_last4" VARCHAR(4) NOT NULL,
    "legal_name" VARCHAR(255) NOT NULL,
    "trade_name" VARCHAR(255),
    "preferred_name" VARCHAR(255),
    "email" VARCHAR(255) NOT NULL,
    "email_blind_index" VARCHAR(64) NOT NULL,
    "phone_country_code" VARCHAR(3) NOT NULL DEFAULT '55',
    "phone_area_code" VARCHAR(3) NOT NULL,
    "phone_number" VARCHAR(11) NOT NULL,
    "birth_date" DATE,
    "mother_name" VARCHAR(255),
    "nationality" VARCHAR(3),
    "marital_status" "MaritalStatus",
    "occupation_code" VARCHAR(10),
    "identity_kind" "IdentityDocumentKind",
    "identity_number" VARCHAR(32),
    "identity_issuer" VARCHAR(32),
    "identity_issued_at" DATE,
    "monthly_income_cents" BIGINT,
    "incorporation_date" DATE,
    "legal_nature_code" VARCHAR(8),
    "main_cnae" VARCHAR(9),
    "secondary_cnaes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "company_size" "CompanySize",
    "monthly_revenue_cents" BIGINT,
    "share_capital_cents" BIGINT,
    "is_politically_exposed" BOOLEAN NOT NULL DEFAULT false,
    "riskRating" "RiskRating",
    "external_id" VARCHAR(128),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "anonymized_at" TIMESTAMPTZ(6),

    CONSTRAINT "account_holder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "address" (
    "id" VARCHAR(40) NOT NULL,
    "environment" "Environment" NOT NULL,
    "holder_id" VARCHAR(40),
    "representative_id" VARCHAR(40),
    "type" "AddressType" NOT NULL DEFAULT 'RESIDENTIAL',
    "postal_code" VARCHAR(8) NOT NULL,
    "street" VARCHAR(255) NOT NULL,
    "number" VARCHAR(16) NOT NULL,
    "complement" VARCHAR(128),
    "district" VARCHAR(128) NOT NULL,
    "city" VARCHAR(128) NOT NULL,
    "state" "BrazilianState" NOT NULL,
    "country" VARCHAR(2) NOT NULL DEFAULT 'BR',
    "ibge_city_code" VARCHAR(7),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_representative" (
    "id" VARCHAR(40) NOT NULL,
    "environment" "Environment" NOT NULL,
    "holder_id" VARCHAR(40) NOT NULL,
    "role" "RepresentativeRole" NOT NULL,
    "tax_id_ciphertext" BYTEA NOT NULL,
    "tax_id_iv" BYTEA NOT NULL,
    "tax_id_tag" BYTEA NOT NULL,
    "tax_id_wrapped_key" BYTEA NOT NULL,
    "tax_id_key_id" VARCHAR(255) NOT NULL,
    "tax_id_blind_index" VARCHAR(64) NOT NULL,
    "tax_id_last4" VARCHAR(4) NOT NULL,
    "full_name" VARCHAR(255) NOT NULL,
    "birth_date" DATE NOT NULL,
    "mother_name" VARCHAR(255),
    "email" VARCHAR(255),
    "phone_area_code" VARCHAR(3),
    "phone_number" VARCHAR(11),
    "ownership_percentage" DECIMAL(9,6),
    "is_ultimate_beneficial_owner" BOOLEAN NOT NULL DEFAULT false,
    "is_signer" BOOLEAN NOT NULL DEFAULT false,
    "is_politically_exposed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "legal_representative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_account" (
    "id" VARCHAR(40) NOT NULL,
    "environment" "Environment" NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "normal_balance" "NormalBalance" NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'BRL',
    "owner_type" "LedgerOwnerType" NOT NULL,
    "owner_id" VARCHAR(40),
    "status" "LedgerAccountStatus" NOT NULL DEFAULT 'OPEN',
    "allows_negative" BOOLEAN NOT NULL DEFAULT false,
    "debits_posted" BIGINT NOT NULL DEFAULT 0,
    "credits_posted" BIGINT NOT NULL DEFAULT 0,
    "debits_pending" BIGINT NOT NULL DEFAULT 0,
    "credits_pending" BIGINT NOT NULL DEFAULT 0,
    "entry_count" BIGINT NOT NULL DEFAULT 0,
    "last_entry_id" VARCHAR(40),
    "version" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ledger_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_transaction" (
    "id" VARCHAR(40) NOT NULL,
    "environment" "Environment" NOT NULL,
    "type" VARCHAR(48) NOT NULL,
    "status" "LedgerTransactionStatus" NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'BRL',
    "amount_cents" BIGINT NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "external_ref" VARCHAR(128),
    "description" VARCHAR(512),
    "pending_transaction_id" VARCHAR(40),
    "effective_at" TIMESTAMPTZ(6) NOT NULL,
    "posted_at" TIMESTAMPTZ(6),
    "voided_at" TIMESTAMPTZ(6),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entry" (
    "id" VARCHAR(40) NOT NULL,
    "environment" "Environment" NOT NULL,
    "transaction_id" VARCHAR(40) NOT NULL,
    "ledger_account_id" VARCHAR(40) NOT NULL,
    "direction" "EntryDirection" NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "phase" "EntryPhase" NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'BRL',
    "sequence" INTEGER NOT NULL,
    "resulting_posted_cents" BIGINT NOT NULL,
    "effective_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_balance_snapshot" (
    "id" VARCHAR(40) NOT NULL,
    "environment" "Environment" NOT NULL,
    "ledger_account_id" VARCHAR(40) NOT NULL,
    "as_of_date" DATE NOT NULL,
    "debits_posted" BIGINT NOT NULL,
    "credits_posted" BIGINT NOT NULL,
    "entry_count" BIGINT NOT NULL,
    "last_entry_id" VARCHAR(40),
    "chain_hash" VARCHAR(64) NOT NULL,
    "prev_chain_hash" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_balance_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_case" (
    "id" VARCHAR(40) NOT NULL,
    "environment" "Environment" NOT NULL,
    "holder_id" VARCHAR(40) NOT NULL,
    "account_id" VARCHAR(40),
    "parent_case_id" VARCHAR(40),
    "provider" "ProviderSlug" NOT NULL,
    "provider_case_id" VARCHAR(128),
    "type" "OnboardingType" NOT NULL,
    "status" "OnboardingStatus" NOT NULL DEFAULT 'DRAFT',
    "last_event_at" TIMESTAMPTZ(6),
    "decision" "OnboardingDecision",
    "rejection_code" "OnboardingRejectionCode",
    "rejection_message" VARCHAR(1024),
    "provider_rejection_code" VARCHAR(64),
    "risk_rating" "RiskRating",
    "risk_score" DECIMAL(9,6),
    "submitted_at" TIMESTAMPTZ(6),
    "decided_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "sla_due_at" TIMESTAMPTZ(6),
    "reviewed_by" VARCHAR(128),
    "review_note" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "onboarding_case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_requirement" (
    "id" VARCHAR(40) NOT NULL,
    "case_id" VARCHAR(40) NOT NULL,
    "code" "RequirementCode" NOT NULL,
    "subject_representative_id" VARCHAR(40),
    "status" "RequirementStatus" NOT NULL DEFAULT 'PENDING',
    "label" VARCHAR(255) NOT NULL,
    "description" VARCHAR(1024),
    "document_id" VARCHAR(40),
    "rejection_code" "OnboardingRejectionCode",
    "rejection_message" VARCHAR(512),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "due_at" TIMESTAMPTZ(6),
    "provider_requirement_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "onboarding_requirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_document" (
    "id" VARCHAR(40) NOT NULL,
    "environment" "Environment" NOT NULL,
    "holder_id" VARCHAR(40) NOT NULL,
    "case_id" VARCHAR(40),
    "kind" "RequirementCode" NOT NULL,
    "side" "DocumentSide",
    "storage_bucket" VARCHAR(128) NOT NULL,
    "storage_key" VARCHAR(512) NOT NULL,
    "content_type" VARCHAR(128) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "provider_document_id" VARCHAR(128),
    "encryption_key_id" VARCHAR(255),
    "retention_until" DATE,
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_screening" (
    "id" VARCHAR(40) NOT NULL,
    "environment" "Environment" NOT NULL,
    "holder_id" VARCHAR(40) NOT NULL,
    "representative_id" VARCHAR(40),
    "case_id" VARCHAR(40),
    "type" "ScreeningType" NOT NULL,
    "source" VARCHAR(64) NOT NULL,
    "result" "ScreeningResult" NOT NULL,
    "score" DECIMAL(9,6),
    "matches" JSONB NOT NULL DEFAULT '[]',
    "raw_ciphertext" BYTEA,
    "raw_iv" BYTEA,
    "raw_tag" BYTEA,
    "raw_wrapped_key" BYTEA,
    "raw_key_id" VARCHAR(255),
    "screened_at" TIMESTAMPTZ(6) NOT NULL,
    "next_due_at" TIMESTAMPTZ(6),
    "reviewed_by" VARCHAR(128),
    "review_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_screening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_record" (
    "id" VARCHAR(40) NOT NULL,
    "environment" "Environment" NOT NULL,
    "api_key_id" VARCHAR(40) NOT NULL,
    "endpoint_key" VARCHAR(255) NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "request_fingerprint" VARCHAR(64) NOT NULL,
    "state" "IdempotencyState" NOT NULL DEFAULT 'IN_FLIGHT',
    "operation_id" VARCHAR(40) NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "response_headers" JSONB,
    "error_code" VARCHAR(64),
    "locked_by" VARCHAR(64),
    "locked_at" TIMESTAMPTZ(6),
    "lease_expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_operation" (
    "id" VARCHAR(40) NOT NULL,
    "environment" "Environment" NOT NULL,
    "connection_id" VARCHAR(40) NOT NULL,
    "kind" VARCHAR(48) NOT NULL,
    "provider_idempotency_key" VARCHAR(255) NOT NULL,
    "status" "OperationStatus" NOT NULL DEFAULT 'PENDING',
    "request_digest" VARCHAR(64) NOT NULL,
    "provider_ref" VARCHAR(128),
    "end_to_end_id" VARCHAR(32),
    "amount_cents" BIGINT,
    "account_id" VARCHAR(40),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" JSONB,
    "next_try_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "provider_operation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_webhook_event" (
    "id" VARCHAR(40) NOT NULL,
    "environment" "Environment" NOT NULL,
    "connection_id" VARCHAR(40) NOT NULL,
    "provider" "ProviderSlug" NOT NULL,
    "dedupe_key" VARCHAR(128) NOT NULL,
    "provider_event_id" VARCHAR(128),
    "event_type_raw" VARCHAR(128),
    "occurred_at" TIMESTAMPTZ(6),
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "headers" JSONB NOT NULL,
    "payload" JSONB NOT NULL,
    "raw_sha256" VARCHAR(64) NOT NULL,
    "signature_valid" BOOLEAN NOT NULL,
    "status" "InboundEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" JSONB,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "inbound_webhook_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_event" (
    "id" VARCHAR(40) NOT NULL,
    "environment" "Environment" NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "data_version" INTEGER NOT NULL DEFAULT 1,
    "provider" "ProviderSlug",
    "connection_id" VARCHAR(40),
    "subject_kind" VARCHAR(48) NOT NULL,
    "subject_id" VARCHAR(40) NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "payload" JSONB NOT NULL,
    "previous" JSONB,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatched_at" TIMESTAMPTZ(6),

    CONSTRAINT "outbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoint" (
    "id" VARCHAR(40) NOT NULL,
    "environment" "Environment" NOT NULL,
    "url" VARCHAR(1024) NOT NULL,
    "description" VARCHAR(255),
    "event_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "secret_ciphertext" BYTEA NOT NULL,
    "secret_iv" BYTEA NOT NULL,
    "secret_tag" BYTEA NOT NULL,
    "secret_wrapped_key" BYTEA NOT NULL,
    "secret_key_id" VARCHAR(255) NOT NULL,
    "previous_secret_ciphertext" BYTEA,
    "previous_secret_iv" BYTEA,
    "previous_secret_tag" BYTEA,
    "previous_secret_wrapped_key" BYTEA,
    "previous_secret_key_id" VARCHAR(255),
    "previous_secret_expires_at" TIMESTAMPTZ(6),
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "disabled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "webhook_endpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_delivery" (
    "id" VARCHAR(40) NOT NULL,
    "event_id" VARCHAR(40) NOT NULL,
    "endpoint_id" VARCHAR(40) NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "request_body_sha256" VARCHAR(64),
    "response_status" INTEGER,
    "response_body_snippet" VARCHAR(2048),
    "duration_ms" INTEGER,
    "error" VARCHAR(512),
    "scheduled_for" TIMESTAMPTZ(6) NOT NULL,
    "attempted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poll_cursor" (
    "id" VARCHAR(40) NOT NULL,
    "connection_id" VARCHAR(40) NOT NULL,
    "stream" VARCHAR(48) NOT NULL,
    "scope_id" VARCHAR(40),
    "cursor" VARCHAR(512),
    "watermark" TIMESTAMPTZ(6) NOT NULL,
    "lap_seconds" INTEGER NOT NULL DEFAULT 300,
    "last_run_at" TIMESTAMPTZ(6),
    "last_error" JSONB,

    CONSTRAINT "poll_cursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" VARCHAR(40) NOT NULL,
    "environment" "Environment" NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_type" "ActorType" NOT NULL,
    "actor_id" VARCHAR(128),
    "actor_label" VARCHAR(255),
    "actor_ip" INET,
    "actor_user_agent" VARCHAR(512),
    "action" VARCHAR(96) NOT NULL,
    "outcome" "AuditOutcome" NOT NULL DEFAULT 'SUCCESS',
    "error_code" VARCHAR(64),
    "resource_type" VARCHAR(48) NOT NULL,
    "resource_id" VARCHAR(40),
    "connection_id" VARCHAR(40),
    "provider" "ProviderSlug",
    "before" JSONB,
    "after" JSONB,
    "changed_fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "request_id" VARCHAR(40),
    "operation_id" VARCHAR(40),
    "provider_call_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "prev_hash" BYTEA,
    "row_hash" BYTEA NOT NULL,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_anchor" (
    "id" VARCHAR(40) NOT NULL,
    "environment" "Environment" NOT NULL,
    "as_of_date" DATE NOT NULL,
    "head_sequence" BIGINT NOT NULL,
    "head_hash" BYTEA NOT NULL,
    "signature" BYTEA,
    "external_ref" VARCHAR(512),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_anchor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_call" (
    "id" VARCHAR(40) NOT NULL,
    "environment" "Environment" NOT NULL,
    "connection_id" VARCHAR(40) NOT NULL,
    "provider" "ProviderSlug" NOT NULL,
    "correlation_id" VARCHAR(40),
    "operation_id" VARCHAR(40),
    "method" VARCHAR(8) NOT NULL,
    "path" VARCHAR(512) NOT NULL,
    "endpoint_class" VARCHAR(16) NOT NULL,
    "request_headers" JSONB NOT NULL,
    "request_body" JSONB,
    "response_status" INTEGER,
    "response_body" JSONB,
    "provider_request_id" VARCHAR(128),
    "duration_ms" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "outcome" VARCHAR(24) NOT NULL,
    "canonical_error_code" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pix_key" (
    "id" VARCHAR(40) NOT NULL,
    "environment" "Environment" NOT NULL,
    "account_id" VARCHAR(40) NOT NULL,
    "type" "PixKeyType" NOT NULL,
    "value" VARCHAR(77) NOT NULL,
    "value_blind_index" VARCHAR(64) NOT NULL,
    "status" "PixKeyStatus" NOT NULL DEFAULT 'PENDING_REGISTRATION',
    "provider_key_id" VARCHAR(128),
    "claim_type" "PixClaimType",
    "claim_status" VARCHAR(32),
    "claim_resolution_due_at" TIMESTAMPTZ(6),
    "claimant_ispb" VARCHAR(8),
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMPTZ(6),
    "removed_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pix_key_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pix_charge" (
    "id" VARCHAR(40) NOT NULL,
    "environment" "Environment" NOT NULL,
    "account_id" VARCHAR(40) NOT NULL,
    "pix_key_id" VARCHAR(40) NOT NULL,
    "kind" "PixChargeKind" NOT NULL,
    "txid" VARCHAR(35) NOT NULL,
    "status" "PixChargeStatus" NOT NULL DEFAULT 'ACTIVE',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "amount_cents" BIGINT,
    "amount_is_changeable" BOOLEAN NOT NULL DEFAULT false,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'BRL',
    "expires_in_seconds" INTEGER,
    "expires_at" TIMESTAMPTZ(6),
    "due_date" DATE,
    "valid_after_due_days" INTEGER,
    "fine" JSONB,
    "interest" JSONB,
    "discounts" JSONB,
    "payer_tax_id_last4" VARCHAR(4),
    "payer_name" VARCHAR(255),
    "payer_request" VARCHAR(140),
    "additional_info" JSONB NOT NULL DEFAULT '[]',
    "emv_payload" TEXT NOT NULL,
    "qr_code_image_url" VARCHAR(1024),
    "location_url" VARCHAR(1024),
    "provider" "ProviderSlug" NOT NULL,
    "provider_charge_id" VARCHAR(128),
    "external_id" VARCHAR(128),
    "paid_amount_cents" BIGINT NOT NULL DEFAULT 0,
    "paid_at" TIMESTAMPTZ(6),
    "last_event_at" TIMESTAMPTZ(6),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pix_charge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_connection" (
    "id" VARCHAR(40) NOT NULL,
    "environment" "Environment" NOT NULL,
    "provider" "ProviderSlug" NOT NULL,
    "label" VARCHAR(64) NOT NULL DEFAULT 'default',
    "status" "ConnectionStatus" NOT NULL DEFAULT 'PENDING_VALIDATION',
    "base_url" VARCHAR(255),
    "credentials_ciphertext" BYTEA NOT NULL,
    "credentials_iv" BYTEA NOT NULL,
    "credentials_tag" BYTEA NOT NULL,
    "credentials_wrapped_key" BYTEA NOT NULL,
    "credentials_key_id" VARCHAR(255) NOT NULL,
    "credentials_version" INTEGER NOT NULL DEFAULT 1,
    "credentials_fingerprint" VARCHAR(80),
    "credentials_last4" VARCHAR(8),
    "credentials_updated_at" TIMESTAMPTZ(6),
    "credentials_updated_by" VARCHAR(128),
    "webhook_secret_ciphertext" BYTEA,
    "webhook_secret_iv" BYTEA,
    "webhook_secret_tag" BYTEA,
    "webhook_secret_wrapped_key" BYTEA,
    "webhook_secret_key_id" VARCHAR(255),
    "config" JSONB NOT NULL DEFAULT '{}',
    "capabilities" JSONB NOT NULL DEFAULT '{}',
    "last_health_check_at" TIMESTAMPTZ(6),
    "last_health_status" VARCHAR(32),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "rotated_at" TIMESTAMPTZ(6),

    CONSTRAINT "provider_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_key" (
    "id" VARCHAR(40) NOT NULL,
    "environment" "Environment" NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "prefix" VARCHAR(64) NOT NULL,
    "last4" VARCHAR(8) NOT NULL,
    "secret_hash" VARCHAR(255) NOT NULL,
    "secret_lookup" BYTEA NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "signing_required" BOOLEAN NOT NULL DEFAULT false,
    "signing_secret_ciphertext" BYTEA,
    "signing_secret_iv" BYTEA,
    "signing_secret_tag" BYTEA,
    "signing_secret_wrapped_key" BYTEA,
    "signing_secret_key_id" VARCHAR(255),
    "ip_allowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rate_limit_tier" VARCHAR(32) NOT NULL DEFAULT 'standard',
    "default_connection_id" VARCHAR(40),
    "status" "ApiKeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_used_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by" VARCHAR(128),
    "created_by" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_key_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "console_user" (
    "id" VARCHAR(40) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255),
    "role" "ConsoleRole" NOT NULL DEFAULT 'VIEWER',
    "totp_secret_ciphertext" BYTEA,
    "totp_secret_iv" BYTEA,
    "totp_secret_tag" BYTEA,
    "totp_secret_wrapped_key" BYTEA,
    "totp_secret_key_id" VARCHAR(255),
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "console_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "console_session" (
    "id" VARCHAR(40) NOT NULL,
    "user_id" VARCHAR(40) NOT NULL,
    "refresh_token_hash" VARCHAR(255) NOT NULL,
    "user_agent" VARCHAR(512),
    "ip_address" INET,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "console_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_run" (
    "id" VARCHAR(40) NOT NULL,
    "environment" "Environment" NOT NULL,
    "connection_id" VARCHAR(40) NOT NULL,
    "account_id" VARCHAR(40),
    "scope" "ReconciliationScope" NOT NULL,
    "window_start" TIMESTAMPTZ(6) NOT NULL,
    "window_end" TIMESTAMPTZ(6) NOT NULL,
    "status" "ReconciliationRunStatus" NOT NULL DEFAULT 'QUEUED',
    "provider_item_count" INTEGER NOT NULL DEFAULT 0,
    "local_item_count" INTEGER NOT NULL DEFAULT 0,
    "ledger_item_count" INTEGER NOT NULL DEFAULT 0,
    "matched_count" INTEGER NOT NULL DEFAULT 0,
    "break_count" INTEGER NOT NULL DEFAULT 0,
    "provider_opening_balance_cents" BIGINT,
    "provider_closing_balance_cents" BIGINT,
    "ledger_closing_balance_cents" BIGINT,
    "balance_delta_cents" BIGINT,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "error" JSONB,
    "triggered_by" VARCHAR(128) NOT NULL,

    CONSTRAINT "reconciliation_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_item" (
    "id" VARCHAR(40) NOT NULL,
    "run_id" VARCHAR(40) NOT NULL,
    "side" "ReconciliationSide" NOT NULL,
    "external_id" VARCHAR(128),
    "end_to_end_id" VARCHAR(32),
    "posted_at" TIMESTAMPTZ(6) NOT NULL,
    "effective_date" DATE NOT NULL,
    "direction" VARCHAR(8) NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "type" VARCHAR(32) NOT NULL,
    "counterparty_tax_id_index" VARCHAR(64),
    "match_key_strong" VARCHAR(128),
    "match_key_fuzzy" VARCHAR(64) NOT NULL,
    "matched_item_id" VARCHAR(40),
    "match_confidence" "MatchConfidence",
    "raw" JSONB NOT NULL,

    CONSTRAINT "reconciliation_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_break" (
    "id" VARCHAR(40) NOT NULL,
    "environment" "Environment" NOT NULL,
    "run_id" VARCHAR(40) NOT NULL,
    "first_seen_run_id" VARCHAR(40) NOT NULL,
    "connection_id" VARCHAR(40) NOT NULL,
    "account_id" VARCHAR(40),
    "type" "BreakType" NOT NULL,
    "severity" "BreakSeverity" NOT NULL,
    "status" "BreakStatus" NOT NULL DEFAULT 'OPEN',
    "amount_cents" BIGINT,
    "delta_cents" BIGINT,
    "effective_date" DATE NOT NULL,
    "end_to_end_id" VARCHAR(32),
    "provider_item_id" VARCHAR(40),
    "local_item_id" VARCHAR(40),
    "ledger_item_id" VARCHAR(40),
    "description" VARCHAR(1024) NOT NULL,
    "evidence" JSONB NOT NULL,
    "age_days" INTEGER NOT NULL DEFAULT 0,
    "assigned_to" VARCHAR(128),
    "resolution" "ResolutionAction",
    "resolution_note" TEXT,
    "resolved_by" VARCHAR(128),
    "resolved_at" TIMESTAMPTZ(6),
    "adjustment_transaction_id" VARCHAR(40),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reconciliation_break_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction" (
    "id" VARCHAR(40) NOT NULL,
    "environment" "Environment" NOT NULL,
    "account_id" VARCHAR(40) NOT NULL,
    "charge_id" VARCHAR(40),
    "parent_transaction_id" VARCHAR(40),
    "type" "TransactionType" NOT NULL,
    "direction" "TransactionDirection" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'CREATED',
    "last_event_at" TIMESTAMPTZ(6),
    "amount_cents" BIGINT NOT NULL,
    "fee_cents" BIGINT NOT NULL DEFAULT 0,
    "net_amount_cents" BIGINT NOT NULL,
    "refunded_amount_cents" BIGINT NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'BRL',
    "description" VARCHAR(512),
    "provider" "ProviderSlug" NOT NULL,
    "provider_connection_id" VARCHAR(40) NOT NULL,
    "provider_transaction_id" VARCHAR(128),
    "external_id" VARCHAR(128),
    "idempotency_key" VARCHAR(255),
    "operation_id" VARCHAR(40),
    "failure_code" VARCHAR(64),
    "provider_failure_code" VARCHAR(64),
    "failure_message" VARCHAR(1024),
    "effective_date" DATE NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processing_at" TIMESTAMPTZ(6),
    "settled_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "reversed_at" TIMESTAMPTZ(6),
    "last_checked_at" TIMESTAMPTZ(6),
    "ledger_pending_transaction_id" VARCHAR(40),
    "ledger_posted_transaction_id" VARCHAR(40),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pix_detail" (
    "transaction_id" VARCHAR(40) NOT NULL,
    "environment" "Environment" NOT NULL,
    "end_to_end_id" VARCHAR(32),
    "return_id" VARCHAR(32),
    "original_end_to_end_id" VARCHAR(32),
    "txid" VARCHAR(35),
    "conciliation_id" VARCHAR(35),
    "initiation_method" "PixInitiationMethod" NOT NULL,
    "purpose" "PixPurpose" NOT NULL DEFAULT 'TRANSFER',
    "key_type" "PixKeyType",
    "key_value" VARCHAR(77),
    "counterparty_name" VARCHAR(255),
    "counterparty_tax_id_index" VARCHAR(64),
    "counterparty_tax_id_last4" VARCHAR(4),
    "counterparty_tax_id_type" "TaxIdType",
    "counterparty_ispb" VARCHAR(8),
    "counterparty_bank_name" VARCHAR(128),
    "counterparty_branch" VARCHAR(8),
    "counterparty_account" VARCHAR(20),
    "counterparty_account_type" "PixAccountType",
    "remittance_info" VARCHAR(140),
    "refund_reason_code" "PixRefundReasonCode",
    "settlement_at" TIMESTAMPTZ(6),

    CONSTRAINT "pix_detail_pkey" PRIMARY KEY ("transaction_id")
);

-- CreateTable
CREATE TABLE "transaction_status_change" (
    "id" VARCHAR(40) NOT NULL,
    "transaction_id" VARCHAR(40) NOT NULL,
    "from_status" "TransactionStatus",
    "to_status" "TransactionStatus" NOT NULL,
    "reason_code" VARCHAR(64),
    "reason_message" VARCHAR(512),
    "source" "ChangeSource" NOT NULL,
    "provider_event_id" VARCHAR(40),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_status_change_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_environment_status_idx" ON "account"("environment", "status");

-- CreateIndex
CREATE INDEX "account_environment_holder_id_idx" ON "account"("environment", "holder_id");

-- CreateIndex
CREATE INDEX "account_environment_created_at_idx" ON "account"("environment", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "account_environment_provider_provider_account_id_key" ON "account"("environment", "provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_environment_external_id_key" ON "account"("environment", "external_id");

-- CreateIndex
CREATE INDEX "account_status_change_account_id_occurred_at_idx" ON "account_status_change"("account_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "account_balance_environment_stale_after_idx" ON "account_balance"("environment", "stale_after");

-- CreateIndex
CREATE INDEX "account_holder_environment_created_at_idx" ON "account_holder"("environment", "created_at" DESC);

-- CreateIndex
CREATE INDEX "account_holder_environment_legal_name_idx" ON "account_holder"("environment", "legal_name");

-- CreateIndex
CREATE UNIQUE INDEX "account_holder_environment_tax_id_blind_index_key" ON "account_holder"("environment", "tax_id_blind_index");

-- CreateIndex
CREATE UNIQUE INDEX "account_holder_environment_external_id_key" ON "account_holder"("environment", "external_id");

-- CreateIndex
CREATE INDEX "address_holder_id_idx" ON "address"("holder_id");

-- CreateIndex
CREATE INDEX "address_representative_id_idx" ON "address"("representative_id");

-- CreateIndex
CREATE INDEX "legal_representative_environment_tax_id_blind_index_idx" ON "legal_representative"("environment", "tax_id_blind_index");

-- CreateIndex
CREATE UNIQUE INDEX "legal_representative_holder_id_tax_id_blind_index_role_key" ON "legal_representative"("holder_id", "tax_id_blind_index", "role");

-- CreateIndex
CREATE INDEX "ledger_account_environment_owner_type_owner_id_idx" ON "ledger_account"("environment", "owner_type", "owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_account_environment_code_key" ON "ledger_account"("environment", "code");

-- CreateIndex
CREATE INDEX "ledger_transaction_environment_external_ref_idx" ON "ledger_transaction"("environment", "external_ref");

-- CreateIndex
CREATE INDEX "ledger_transaction_environment_status_effective_at_idx" ON "ledger_transaction"("environment", "status", "effective_at");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transaction_environment_idempotency_key_key" ON "ledger_transaction"("environment", "idempotency_key");

-- CreateIndex
CREATE INDEX "ledger_entry_ledger_account_id_effective_at_id_idx" ON "ledger_entry"("ledger_account_id", "effective_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "ledger_entry_ledger_account_id_phase_idx" ON "ledger_entry"("ledger_account_id", "phase");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entry_transaction_id_sequence_key" ON "ledger_entry"("transaction_id", "sequence");

-- CreateIndex
CREATE INDEX "ledger_balance_snapshot_environment_as_of_date_idx" ON "ledger_balance_snapshot"("environment", "as_of_date");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_balance_snapshot_ledger_account_id_as_of_date_key" ON "ledger_balance_snapshot"("ledger_account_id", "as_of_date");

-- CreateIndex
CREATE INDEX "onboarding_case_environment_status_sla_due_at_idx" ON "onboarding_case"("environment", "status", "sla_due_at");

-- CreateIndex
CREATE INDEX "onboarding_case_environment_holder_id_idx" ON "onboarding_case"("environment", "holder_id");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_case_environment_provider_provider_case_id_key" ON "onboarding_case"("environment", "provider", "provider_case_id");

-- CreateIndex
CREATE INDEX "onboarding_requirement_case_id_status_idx" ON "onboarding_requirement"("case_id", "status");

-- CreateIndex
CREATE INDEX "kyc_document_environment_holder_id_kind_idx" ON "kyc_document"("environment", "holder_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_document_environment_holder_id_sha256_key" ON "kyc_document"("environment", "holder_id", "sha256");

-- CreateIndex
CREATE INDEX "compliance_screening_environment_holder_id_type_screened_at_idx" ON "compliance_screening"("environment", "holder_id", "type", "screened_at" DESC);

-- CreateIndex
CREATE INDEX "compliance_screening_environment_next_due_at_idx" ON "compliance_screening"("environment", "next_due_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_record_operation_id_key" ON "idempotency_record"("operation_id");

-- CreateIndex
CREATE INDEX "idempotency_record_expires_at_idx" ON "idempotency_record"("expires_at");

-- CreateIndex
CREATE INDEX "idempotency_record_state_lease_expires_at_idx" ON "idempotency_record"("state", "lease_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_record_environment_endpoint_key_key_key" ON "idempotency_record"("environment", "endpoint_key", "key");

-- CreateIndex
CREATE INDEX "provider_operation_status_updated_at_idx" ON "provider_operation"("status", "updated_at");

-- CreateIndex
CREATE INDEX "provider_operation_environment_end_to_end_id_idx" ON "provider_operation"("environment", "end_to_end_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_operation_connection_id_provider_idempotency_key_key" ON "provider_operation"("connection_id", "provider_idempotency_key");

-- CreateIndex
CREATE INDEX "inbound_webhook_event_status_received_at_idx" ON "inbound_webhook_event"("status", "received_at");

-- CreateIndex
CREATE INDEX "inbound_webhook_event_environment_received_at_idx" ON "inbound_webhook_event"("environment", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_webhook_event_connection_id_dedupe_key_key" ON "inbound_webhook_event"("connection_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "outbox_event_dispatched_at_id_idx" ON "outbox_event"("dispatched_at", "id");

-- CreateIndex
CREATE INDEX "outbox_event_environment_subject_kind_subject_id_sequence_idx" ON "outbox_event"("environment", "subject_kind", "subject_id", "sequence");

-- CreateIndex
CREATE INDEX "webhook_endpoint_environment_status_idx" ON "webhook_endpoint"("environment", "status");

-- CreateIndex
CREATE INDEX "webhook_delivery_status_scheduled_for_idx" ON "webhook_delivery"("status", "scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_delivery_event_id_endpoint_id_attempt_key" ON "webhook_delivery"("event_id", "endpoint_id", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "poll_cursor_connection_id_stream_scope_id_key" ON "poll_cursor"("connection_id", "stream", "scope_id");

-- CreateIndex
CREATE INDEX "audit_log_environment_occurred_at_idx" ON "audit_log"("environment", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_environment_resource_type_resource_id_occurred_at_idx" ON "audit_log"("environment", "resource_type", "resource_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_environment_actor_type_actor_id_occurred_at_idx" ON "audit_log"("environment", "actor_type", "actor_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_request_id_idx" ON "audit_log"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_anchor_environment_as_of_date_key" ON "audit_anchor"("environment", "as_of_date");

-- CreateIndex
CREATE INDEX "provider_call_environment_created_at_idx" ON "provider_call"("environment", "created_at" DESC);

-- CreateIndex
CREATE INDEX "provider_call_correlation_id_idx" ON "provider_call"("correlation_id");

-- CreateIndex
CREATE INDEX "provider_call_operation_id_idx" ON "provider_call"("operation_id");

-- CreateIndex
CREATE INDEX "pix_key_account_id_status_idx" ON "pix_key"("account_id", "status");

-- CreateIndex
CREATE INDEX "pix_key_environment_value_blind_index_idx" ON "pix_key"("environment", "value_blind_index");

-- CreateIndex
CREATE INDEX "pix_charge_environment_account_id_status_idx" ON "pix_charge"("environment", "account_id", "status");

-- CreateIndex
CREATE INDEX "pix_charge_environment_expires_at_idx" ON "pix_charge"("environment", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "pix_charge_environment_txid_key" ON "pix_charge"("environment", "txid");

-- CreateIndex
CREATE UNIQUE INDEX "pix_charge_environment_provider_provider_charge_id_key" ON "pix_charge"("environment", "provider", "provider_charge_id");

-- CreateIndex
CREATE UNIQUE INDEX "pix_charge_environment_external_id_key" ON "pix_charge"("environment", "external_id");

-- CreateIndex
CREATE INDEX "provider_connection_environment_status_idx" ON "provider_connection"("environment", "status");

-- CreateIndex
CREATE UNIQUE INDEX "provider_connection_environment_provider_label_key" ON "provider_connection"("environment", "provider", "label");

-- CreateIndex
CREATE UNIQUE INDEX "api_key_prefix_key" ON "api_key"("prefix");

-- CreateIndex
CREATE INDEX "api_key_secret_lookup_idx" ON "api_key"("secret_lookup");

-- CreateIndex
CREATE INDEX "api_key_environment_status_idx" ON "api_key"("environment", "status");

-- CreateIndex
CREATE UNIQUE INDEX "console_user_email_key" ON "console_user"("email");

-- CreateIndex
CREATE INDEX "console_session_user_id_expires_at_idx" ON "console_session"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "console_session_refresh_token_hash_idx" ON "console_session"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "reconciliation_run_environment_connection_id_window_start_idx" ON "reconciliation_run"("environment", "connection_id", "window_start");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_run_connection_id_account_id_scope_window_st_key" ON "reconciliation_run"("connection_id", "account_id", "scope", "window_start", "window_end");

-- CreateIndex
CREATE INDEX "reconciliation_item_run_id_side_match_key_strong_idx" ON "reconciliation_item"("run_id", "side", "match_key_strong");

-- CreateIndex
CREATE INDEX "reconciliation_item_run_id_side_match_key_fuzzy_idx" ON "reconciliation_item"("run_id", "side", "match_key_fuzzy");

-- CreateIndex
CREATE INDEX "reconciliation_break_environment_status_severity_effective__idx" ON "reconciliation_break"("environment", "status", "severity", "effective_date");

-- CreateIndex
CREATE INDEX "reconciliation_break_environment_account_id_status_idx" ON "reconciliation_break"("environment", "account_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_break_connection_id_type_end_to_end_id_effec_key" ON "reconciliation_break"("connection_id", "type", "end_to_end_id", "effective_date");

-- CreateIndex
CREATE INDEX "transaction_environment_account_id_created_at_idx" ON "transaction"("environment", "account_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "transaction_environment_status_last_checked_at_idx" ON "transaction"("environment", "status", "last_checked_at");

-- CreateIndex
CREATE INDEX "transaction_environment_effective_date_type_idx" ON "transaction"("environment", "effective_date", "type");

-- CreateIndex
CREATE INDEX "transaction_account_id_effective_date_id_idx" ON "transaction"("account_id", "effective_date" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "transaction_environment_provider_provider_transaction_id_key" ON "transaction"("environment", "provider", "provider_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_environment_idempotency_key_key" ON "transaction"("environment", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_environment_external_id_key" ON "transaction"("environment", "external_id");

-- CreateIndex
CREATE INDEX "pix_detail_environment_txid_idx" ON "pix_detail"("environment", "txid");

-- CreateIndex
CREATE INDEX "pix_detail_environment_original_end_to_end_id_idx" ON "pix_detail"("environment", "original_end_to_end_id");

-- CreateIndex
CREATE INDEX "pix_detail_environment_counterparty_tax_id_index_idx" ON "pix_detail"("environment", "counterparty_tax_id_index");

-- CreateIndex
CREATE INDEX "transaction_status_change_transaction_id_occurred_at_idx" ON "transaction_status_change"("transaction_id", "occurred_at" DESC);

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_holder_id_fkey" FOREIGN KEY ("holder_id") REFERENCES "account_holder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_provider_connection_id_fkey" FOREIGN KEY ("provider_connection_id") REFERENCES "provider_connection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_status_change" ADD CONSTRAINT "account_status_change_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_balance" ADD CONSTRAINT "account_balance_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "address" ADD CONSTRAINT "address_holder_id_fkey" FOREIGN KEY ("holder_id") REFERENCES "account_holder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "address" ADD CONSTRAINT "address_representative_id_fkey" FOREIGN KEY ("representative_id") REFERENCES "legal_representative"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_representative" ADD CONSTRAINT "legal_representative_holder_id_fkey" FOREIGN KEY ("holder_id") REFERENCES "account_holder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_transaction" ADD CONSTRAINT "ledger_transaction_pending_transaction_id_fkey" FOREIGN KEY ("pending_transaction_id") REFERENCES "ledger_transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "ledger_transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_ledger_account_id_fkey" FOREIGN KEY ("ledger_account_id") REFERENCES "ledger_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_balance_snapshot" ADD CONSTRAINT "ledger_balance_snapshot_ledger_account_id_fkey" FOREIGN KEY ("ledger_account_id") REFERENCES "ledger_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_case" ADD CONSTRAINT "onboarding_case_holder_id_fkey" FOREIGN KEY ("holder_id") REFERENCES "account_holder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_case" ADD CONSTRAINT "onboarding_case_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_case" ADD CONSTRAINT "onboarding_case_parent_case_id_fkey" FOREIGN KEY ("parent_case_id") REFERENCES "onboarding_case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_requirement" ADD CONSTRAINT "onboarding_requirement_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "onboarding_case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_requirement" ADD CONSTRAINT "onboarding_requirement_subject_representative_id_fkey" FOREIGN KEY ("subject_representative_id") REFERENCES "legal_representative"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_requirement" ADD CONSTRAINT "onboarding_requirement_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "kyc_document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_document" ADD CONSTRAINT "kyc_document_holder_id_fkey" FOREIGN KEY ("holder_id") REFERENCES "account_holder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_document" ADD CONSTRAINT "kyc_document_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "onboarding_case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_screening" ADD CONSTRAINT "compliance_screening_holder_id_fkey" FOREIGN KEY ("holder_id") REFERENCES "account_holder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_screening" ADD CONSTRAINT "compliance_screening_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "onboarding_case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "outbox_event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_cursor" ADD CONSTRAINT "poll_cursor_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "provider_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pix_key" ADD CONSTRAINT "pix_key_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pix_charge" ADD CONSTRAINT "pix_charge_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pix_charge" ADD CONSTRAINT "pix_charge_pix_key_id_fkey" FOREIGN KEY ("pix_key_id") REFERENCES "pix_key"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_default_connection_id_fkey" FOREIGN KEY ("default_connection_id") REFERENCES "provider_connection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "console_session" ADD CONSTRAINT "console_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "console_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_item" ADD CONSTRAINT "reconciliation_item_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "reconciliation_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_break" ADD CONSTRAINT "reconciliation_break_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "reconciliation_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_charge_id_fkey" FOREIGN KEY ("charge_id") REFERENCES "pix_charge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_parent_transaction_id_fkey" FOREIGN KEY ("parent_transaction_id") REFERENCES "transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pix_detail" ADD CONSTRAINT "pix_detail_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_status_change" ADD CONSTRAINT "transaction_status_change_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

