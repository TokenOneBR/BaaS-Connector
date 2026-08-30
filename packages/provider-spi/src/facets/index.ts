import type { CanonicalEventDraft, RawWebhookRequest, WebhookSecret } from '../webhooks.js';

import type { AccountRef, HealthReport, Page, Pagination } from './common.js';
import type {
  CreateAccountPFInput,
  CreateAccountPJInput,
  CreateDynamicChargeInput,
  CreateRefundInput,
  CreateStaticChargeInput,
  DocumentReceipt,
  DocumentUpload,
  OnboardingCase,
  PendingRequirement,
  PixCharge,
  PixKey,
  PixKeyResolution,
  PixRefund,
  PixTransaction,
  PldScreeningInput,
  MoneyJSON,
  PldScreeningResult,
  ProviderAccount,
  ProviderBalance,
  SendPixInput,
  StatementEntry,
  StatementQuery,
} from './types.js';

/**
 * Facetas independentes em vez de uma interface unica com 30 metodos.
 *
 * Com interface unica, todo adapter e forcado a implementar tudo com stub, e
 * "suportado" fica indistinguivel de "lanca excecao". Faceta ausente e um
 * fato verificavel; stub que lanca nao e.
 */

export interface AccountsFacet {
  createPF(input: CreateAccountPFInput): Promise<ProviderAccount>;
  createPJ(input: CreateAccountPJInput): Promise<ProviderAccount>;
  get(ref: AccountRef): Promise<ProviderAccount>;
  list(query: Pagination): Promise<Page<ProviderAccount>>;
  updateStatus(
    ref: AccountRef,
    input: { blocked: boolean; reason?: string },
  ): Promise<ProviderAccount>;
  close(ref: AccountRef, input: { reason: string }): Promise<ProviderAccount>;
}

export interface OnboardingFacet {
  submitKyc(ref: AccountRef, input: { termsAcceptedAt?: string }): Promise<OnboardingCase>;
  submitKyb(ref: AccountRef, input: { termsAcceptedAt?: string }): Promise<OnboardingCase>;
  getStatus(providerCaseId: string): Promise<OnboardingCase>;
  uploadDocument(providerCaseId: string, document: DocumentUpload): Promise<DocumentReceipt>;
  listRequirements(providerCaseId: string): Promise<PendingRequirement[]>;
  fulfillRequirement(
    providerCaseId: string,
    input: { code: string; documentId?: string; data?: Record<string, unknown> },
  ): Promise<OnboardingCase>;
  screenPld?(input: PldScreeningInput): Promise<PldScreeningResult>;
}

export interface BalanceFacet {
  get(ref: AccountRef): Promise<ProviderBalance>;
}

export interface PixKeysFacet {
  create(ref: AccountRef, input: { type: string; value?: string }): Promise<PixKey>;
  list(ref: AccountRef): Promise<PixKey[]>;
  delete(ref: AccountRef, key: string): Promise<void>;
  claim?(ref: AccountRef, input: { key: string; type: string }): Promise<PixKey>;
  /** Consulta DICT de chave de terceiro. Informativa: nao autoriza pagamento. */
  resolve?(ref: AccountRef, key: string): Promise<PixKeyResolution>;
}

export interface PixChargesFacet {
  createStatic(ref: AccountRef, input: CreateStaticChargeInput): Promise<PixCharge>;
  createDynamic(ref: AccountRef, input: CreateDynamicChargeInput): Promise<PixCharge>;
  updateDynamic?(
    ref: AccountRef,
    txid: string,
    input: Partial<CreateDynamicChargeInput>,
  ): Promise<PixCharge>;
  get(ref: AccountRef, txid: string): Promise<PixCharge>;
  list(
    ref: AccountRef,
    query: Pagination & { from?: string; to?: string },
  ): Promise<Page<PixCharge>>;
  cancel?(ref: AccountRef, txid: string): Promise<PixCharge>;
}

export interface PixTransfersFacet {
  /** DEVE ser idempotente em relacao a `input.idempotencyKey`. */
  send(ref: AccountRef, input: SendPixInput): Promise<PixTransaction>;
  get(ref: AccountRef, providerTransactionId: string): Promise<PixTransaction>;
  refund?(ref: AccountRef, input: CreateRefundInput): Promise<PixRefund>;
  getRefund?(ref: AccountRef, providerRefundId: string): Promise<PixRefund>;
  /**
   * Consulta pela NOSSA chave, nao pelo id do provedor.
   *
   * E o que torna possivel resolver um desfecho desconhecido sem reenviar o
   * pagamento. Obrigatorio quando `idempotency.mode === 'none'`.
   */
  findByIdempotencyKey?(ref: AccountRef, key: string): Promise<PixTransaction | null>;
}

/**
 * Pagina de extrato, com os saldos da JANELA.
 *
 * Os saldos sao da consulta, nao da pagina: identicos em toda pagina da mesma
 * janela, e quem consome le da primeira que receber. Sao OPCIONAIS porque a
 * maioria dos provedores nao os informa — e exigi-los obrigaria todo adapter a
 * inventar um numero. Um saldo ausente a conciliacao declara (`skippedReason`);
 * um saldo inventado ela acredita, e passa a abrir quebra de saldo em cima de
 * ficcao.
 *
 * Quem os informa precisa que fechem: `abertura + Σ(creditos − debitos da
 * janela) = fechamento`. A suite de conformidade verifica isso.
 */
export interface StatementPage extends Page<StatementEntry> {
  /** Saldo postado imediatamente ANTES do inicio da janela. */
  openingBalance?: MoneyJSON;
  /** Saldo postado ao FIM da janela. */
  closingBalance?: MoneyJSON;
}

export interface StatementFacet {
  list(ref: AccountRef, query: StatementQuery & Pagination): Promise<StatementPage>;
  /** Exportacao assincrona, mais barata para janelas grandes. */
  export?(ref: AccountRef, query: StatementQuery): Promise<{ handle: string; readyAt?: string }>;
}

export interface WebhookFacet {
  /**
   * Funcao pura, sem I/O. Recebe os BYTES CRUS, nunca o JSON parseado:
   * qualquer reserializacao muda a assinatura.
   *
   * Lanca `BaasError(SIGNATURE_INVALID)` quando nao confere.
   */
  verifySignature(request: RawWebhookRequest, secret: WebhookSecret): void;

  /** Identidade estavel para deduplicacao entre reentregas. */
  eventIdentity(request: RawWebhookRequest): { providerEventId: string; occurredAt?: string };

  /** Payload do provedor para zero ou mais eventos canonicos. */
  parse(request: RawWebhookRequest): CanonicalEventDraft[];

  /** Alguns provedores exigem corpo ou status especifico no ack. */
  ackResponse?(): { status: number; body?: unknown };
}

export interface ProviderAdapter {
  readonly slug: string;
  readonly displayName: string;

  readonly accounts?: AccountsFacet;
  readonly onboarding?: OnboardingFacet;
  readonly balance?: BalanceFacet;
  readonly pixKeys?: PixKeysFacet;
  readonly pixCharges?: PixChargesFacet;
  readonly pixTransfers?: PixTransfersFacet;
  readonly statement?: StatementFacet;
  readonly webhooks?: WebhookFacet;

  /** Sonda barata de liveness. Nunca entra no readiness do Kubernetes. */
  health(): Promise<HealthReport>;
}

export * from './common.js';
export * from './types.js';
