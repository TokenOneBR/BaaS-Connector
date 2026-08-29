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
export { InProcessEventQueue } from './events/in-process-queue.js';
export {
  ACCOUNT_REPOSITORY,
  HOLDER_REPOSITORY,
  ONBOARDING_REPOSITORY,
} from './accounts/accounts.types.js';
export { AUDIT_REPOSITORY, EVENT_QUEUE, OUTBOX_REPOSITORY } from './events/outbox.types.js';
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
  MemoryAuditRepository,
  MemoryInboundEventRepository,
  MemoryOnboardingRepository,
  MemoryOutboxRepository,
} from './persistence/memory/domain.repositories.js';
export type {
  MemoryOperationRepository,
  MemoryPixChargeRepository,
  MemoryPixKeyRepository,
  MemoryTransactionRepository,
} from './persistence/memory/pix.repositories.js';
export type { MemoryLedgerStoreFactory } from './ledger/memory-ledger-store.js';
