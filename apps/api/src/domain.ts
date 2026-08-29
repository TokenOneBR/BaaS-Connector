/**
 * Superficie de dominio reutilizavel entre processos.
 *
 * Existe para `apps/worker` compor a MESMA raiz de composicao da API — os
 * mesmos repositorios, o mesmo resolvedor de provedor, o mesmo razao sombra —
 * sem duplicar a camada inteira nem sem fazer um refactor de extracao no meio
 * da branch. Precedente: `./app` e `./testing`, ja consumidos pelo e2e. Os
 * dois apps sao `private: true`, entao nada disto vai para publicacao.
 *
 * A REGRA desta fronteira: exporta MODULOS e PORTAS, nunca implementacoes.
 *
 * - `AppModule` fica de fora: carrega guards de autenticacao de requisicao,
 *   interceptor, filtro e CORS. Um worker que o importasse instanciaria
 *   autenticacao HTTP que ele nunca vai servir.
 * - Modulos com controller (`WebhooksModule`, `PixModule`, `AccountsModule`,
 *   `AdminModule`, `BalanceModule`) ficam de fora pelo mesmo motivo — por
 *   isso os dois modulos finos, `WebhookApplyModule` e
 *   `OperationReconcilerModule`.
 * - Classes `Prisma*Repository` e `Memory*Repository` ficam de fora: sao
 *   implementacoes. Expor a classe convida `new PrismaX(...)` no worker, e a
 *   decisao memoria/Prisma deixaria de ser tomada uma vez, na raiz.
 * - `InProcessEventQueue` fica de fora: se o worker consegue importa-la,
 *   um dia alguem a liga por engano e o worker processa em memoria — sem
 *   durabilidade, e sem ninguem perceber ate um pod morrer com jobs em voo.
 *
 * Cada simbolo daqui vira API de fato entre dois apps. Quanto mais larga a
 * superficie, mais um refactor na API quebra o build do worker, e menos a
 * fronteira significa alguma coisa.
 */

// --------------------------- modulos ---------------------------
export { CacheModule } from './cache/cache.module.js';
export { ConfigModule } from './config/config.module.js';
export { CryptoModule } from './crypto/crypto.module.js';
export { LedgerModule } from './ledger/ledger.module.js';
export { ObservabilityModule } from './observability/observability.module.js';
export { OperationReconcilerModule } from './pix/operation-reconciler.module.js';
export { PersistenceModule } from './persistence/persistence.module.js';
export { ProvidersModule } from './providers/providers.module.js';
export { WebhookApplyModule } from './webhooks/webhook-apply.module.js';

// --------------------------- servicos ---------------------------
// `Metrics` sai DAQUI, e nao de `@baasconn/observability` direto: o container
// do Nest compara token por identidade de objeto, e um consumidor que importe
// a classe por outro caminho pode receber uma instancia de modulo diferente da
// que `ObservabilityModule` proveu. Uma seam, uma identidade.
export { Metrics } from '@baasconn/observability';
export { ApiConfig } from './config/config.service.js';
export { OperationReconciler } from './pix/operation-reconciler.js';
export { PrismaService } from './persistence/prisma.service.js';
export { ProviderResolver } from './providers/provider.resolver.js';
export { ShadowLedgerService } from './ledger/shadow-ledger.service.js';
export { WebhookApplyService } from './webhooks/webhook-apply.service.js';
export type { BoundProvider } from './providers/provider.resolver.js';
export type { ReconcileOutcome } from './pix/operation-reconciler.js';

// --------------------------- portas ---------------------------
export { CLOCK, type Clock } from './common/clock.js';
export { REDIS } from './persistence/redis.provider.js';
export { CACHE_STORE, accountTag, cacheKey, type CacheStore } from './cache/cache.types.js';
export { LEDGER_STORE_FACTORY, type LedgerStoreFactory } from './ledger/ledger.types.js';
export {
  ACCOUNT_REPOSITORY,
  HOLDER_REPOSITORY,
  ONBOARDING_REPOSITORY,
  type AccountRecord,
  type AccountRepository,
  type ListAccountsFilter,
} from './accounts/accounts.types.js';
export {
  AUDIT_REPOSITORY,
  EVENT_QUEUE,
  OUTBOX_REPOSITORY,
  type AuditRepository,
  type EventQueue,
  type OutboxRepository,
  type OutboxDispatchJob,
  type QueuedJob,
} from './events/outbox.types.js';
export {
  OUTBOX_DISPATCH_REPOSITORY,
  WEBHOOK_DELIVERY_REPOSITORY,
  WEBHOOK_ENDPOINT_REPOSITORY,
  type ClaimedOutboxEvent,
  type DueDelivery,
  type OutboxDispatchRepository,
  type SecretEnvelope,
  type WebhookDeliveryRecord,
  type WebhookDeliveryRepository,
  type WebhookEndpointRecord,
  type WebhookEndpointRepository,
} from './events/outbox-delivery.types.js';
export { decideDelivery, nextAttemptAt, type DeliveryDecision } from './events/delivery-outcome.js';
export { matchesEventType } from './events/event-type-filter.js';
export { EnvelopeCrypto } from '@baasconn/crypto';
export {
  INBOUND_EVENT_REPOSITORY,
  type InboundEventRecord,
  type InboundEventRepository,
} from './webhooks/webhooks.types.js';
export {
  OPERATION_REPOSITORY,
  PIX_CHARGE_REPOSITORY,
  TRANSACTION_REPOSITORY,
  type OperationRecord,
  type OperationRepository,
  type TransactionRecord,
  type TransactionRepository,
} from './pix/pix.types.js';
export {
  CONNECTION_REPOSITORY,
  type ConnectionRepository,
  type StoredConnection,
} from './providers/credential.resolver.js';
