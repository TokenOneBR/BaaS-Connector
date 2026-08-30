import {
  CacheModule,
  ConfigModule,
  CryptoModule,
  LedgerModule,
  ObservabilityModule,
  OperationReconcilerModule,
  PersistenceModule,
  ProvidersModule,
  WebhookApplyModule,
} from '@baasconn/api/domain';
import { Module } from '@nestjs/common';

import { MaintenanceModule } from './maintenance/maintenance.module.js';
import { OutboxModule } from './outbox/outbox.module.js';
import { BullMqModule } from './queues/bullmq.module.js';
import { ReconciliationModule } from './reconciliation/reconciliation.module.js';

/**
 * Raiz do worker.
 *
 * Importa os MESMOS modulos que a API compoe — a mesma raiz de composicao, os
 * mesmos repositorios, o mesmo resolvedor de provedor. O que NAO entra sao os
 * modulos com controller e o `AppModule`: um worker que carregasse guards de
 * autenticacao de requisicao instanciaria autenticacao HTTP que ele nunca vai
 * servir.
 */
@Module({
  imports: [
    ConfigModule,
    ObservabilityModule,
    CryptoModule,
    CacheModule,
    LedgerModule,
    PersistenceModule,
    ProvidersModule,
    WebhookApplyModule,
    OperationReconcilerModule,
    BullMqModule,
    OutboxModule,
    MaintenanceModule,
    ReconciliationModule,
  ],
})
export class WorkerModule {}
