/**
 * Ponto de entrada para testes de fora do pacote.
 *
 * Existe para a suite de ponta a ponta nao precisar alcancar `src/**` por
 * caminho relativo, atravessando a fronteira do pacote. O que sai daqui e
 * exatamente o necessario para montar a aplicacao com dependencias
 * substituidas: os TOKENS de injecao e o modulo raiz.
 *
 * Nao e publicado — o app e `private` — e nao e importado por codigo de
 * producao.
 */
export { AppModule } from './app.module.js';
export { API_KEY_REPOSITORY, NONCE_STORE } from './auth/api-key.service.js';
export { CONNECTION_REPOSITORY } from './providers/credential.resolver.js';
export { CONNECTION_LOOKUP } from './providers/provider.registry.js';
export {
  ACCOUNT_REPOSITORY,
  HOLDER_REPOSITORY,
  ONBOARDING_REPOSITORY,
} from './accounts/accounts.types.js';
export { AUDIT_REPOSITORY, EVENT_QUEUE, OUTBOX_REPOSITORY } from './events/outbox.types.js';
// A PORTA, nao a implementacao. O e2e drena pela interface, entao trocar o
// binding por BullMQ no marco do worker nao quebra o harness.
export type { EventQueue, QueuedJob } from './events/outbox.types.js';
export { INBOUND_EVENT_REPOSITORY } from './webhooks/webhooks.types.js';
export {
  OPERATION_REPOSITORY,
  PIX_CHARGE_REPOSITORY,
  PIX_KEY_REPOSITORY,
  TRANSACTION_REPOSITORY,
} from './pix/pix.types.js';
export { LEDGER_STORE_FACTORY } from './ledger/ledger.types.js';
export { buildSignature, generateNonce } from './auth/api-key.service.js';
export type {
  MemoryAccountRepository,
  MemoryInboundEventRepository,
  MemoryOnboardingRepository,
} from './persistence/memory/domain.repositories.js';
export type {
  MemoryPixChargeRepository,
  MemoryPixKeyRepository,
} from './persistence/memory/pix.repositories.js';
export { MemoryOperationRepository } from './persistence/memory/pix.repositories.js';
// Mesma razao dos dobros de despacho abaixo: o teste do worker os CONSTROI.
export {
  MemoryAuditRepository,
  MemoryOutboxRepository,
} from './persistence/memory/domain.repositories.js';
export { MemoryTransactionRepository } from './persistence/memory/pix.repositories.js';
export type { MemoryLedgerStoreFactory } from './ledger/memory-ledger-store.js';
// Estes saem como VALOR, e nao so como tipo: o teste de integracao do worker
// monta o despachante com eles. Sao dobros, que e exatamente o que este
// barril existe para publicar — continuam fora de `./domain`, onde entrariam
// como implementacao no caminho de producao.
export {
  MemoryOutboxDispatchRepository,
  MemoryWebhookDeliveryRepository,
  MemoryWebhookEndpointRepository,
} from './persistence/memory/outbox-delivery.repositories.js';
export {
  MemoryReconciliationBreakRepository,
  MemoryReconciliationRunRepository,
} from './persistence/memory/reconciliation.repositories.js';
export { MemoryPollCursorRepository } from './persistence/memory/reconciliation.repositories.js';

// Tokens e classes que a suite de ponta a ponta precisa para montar a
// conciliacao a mao.
//
// Saem por AQUI, e nao por `./domain`, de proposito: `./domain` aponta para o
// `dist`, e o harness sobe a aplicacao a partir do `src`. Os tokens sao
// `Symbol()`, entao o mesmo nome vindo das duas seams sao DOIS tokens
// diferentes e o `app.get()` nao acha nada. Uma seam, uma identidade.
export {
  RECONCILIATION_BREAK_REPOSITORY,
  RECONCILIATION_RUN_REPOSITORY,
} from './reconciliation/reconciliation.types.js';
export type {
  ReconciliationBreakRecord,
  ReconciliationBreakRepository,
  ReconciliationRunRecord,
  ReconciliationRunRepository,
} from './reconciliation/reconciliation.types.js';
export { BreakResolutionService } from './reconciliation/break-resolution.service.js';
export { CLOCK } from './common/clock.js';
export { ProviderResolver } from './providers/provider.resolver.js';
export { ShadowLedgerService } from './ledger/shadow-ledger.service.js';
export { WebhookApplyService } from './webhooks/webhook-apply.service.js';
export type { AccountRecord } from './accounts/accounts.types.js';
