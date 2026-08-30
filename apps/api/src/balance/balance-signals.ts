import type { Environment } from '@baasconn/taxonomy';
import { Inject, Injectable } from '@nestjs/common';

import { ACCOUNT_REPOSITORY, type AccountRepository } from '../accounts/accounts.types.js';
import {
  RECONCILIATION_BREAK_REPOSITORY,
  type ReconciliationBreakRepository,
} from '../reconciliation/reconciliation.types.js';

import type { BalanceSignals } from './balance.service.js';

/**
 * Sinais que decidem o bypass do cache.
 *
 * A regra 5 esteve implementada, testada e DESLIGADA desde o M6, porque
 * `hasHighSeverityBreak` devolvia `false` fixo — nao havia quebras para
 * consultar. A lacuna era declarada e nao um esquecimento, e e este o commit
 * que a fecha: com a conciliacao abrindo quebras, servir saldo do cache numa
 * conta cujos numeros JA SABEMOS que divergem seria repetir um valor de que
 * temos motivo para duvidar.
 */
@Injectable()
export class DefaultBalanceSignals implements BalanceSignals {
  constructor(
    @Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository,
    @Inject(RECONCILIATION_BREAK_REPOSITORY) private readonly breaks: ReconciliationBreakRepository,
  ) {}

  async hasHighSeverityBreak(environment: Environment, accountId: string): Promise<boolean> {
    // `count` e nao `findMany`: so interessa se existe pelo menos uma, e o
    // indice `[environment, accountId, status]` ja serve esta consulta.
    return (await this.breaks.countOpenHighSeverity(environment, accountId)) > 0;
  }

  async lastKnownMovementAt(
    environment: Environment,
    accountId: string,
  ): Promise<Date | undefined> {
    const account = await this.accounts.findById(environment, accountId);
    return account?.lastEventAt ?? undefined;
  }
}
