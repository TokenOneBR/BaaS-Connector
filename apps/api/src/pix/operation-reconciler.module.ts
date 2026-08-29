import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { ProvidersModule } from '../providers/providers.module.js';

import { OperationReconciler } from './operation-reconciler.js';

/**
 * Resolvedor de desfecho desconhecido, isolado do resto do PIX.
 *
 * O worker agenda a escada de retry e precisa so desta peca. Importar
 * `PixModule` inteiro traria dois controllers e o servico de transferencia —
 * que sabe ENVIAR dinheiro. Um worker de conciliacao nao deve ter esse
 * caminho no grafo de injecao: a regra e "nunca reenvia", e a forma mais
 * barata de garanti-la e ele nao conseguir.
 */
@Module({
  imports: [ProvidersModule, AccountsModule, LedgerModule],
  providers: [OperationReconciler],
  exports: [OperationReconciler],
})
export class OperationReconcilerModule {}
