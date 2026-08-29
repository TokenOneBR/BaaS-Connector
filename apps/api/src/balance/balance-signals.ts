import type { Environment } from '@baasconn/taxonomy';
import { Inject, Injectable } from '@nestjs/common';

import { ACCOUNT_REPOSITORY, type AccountRepository } from '../accounts/accounts.types.js';

import type { BalanceSignals } from './balance.service.js';

/**
 * Sinais que decidem o bypass do cache.
 *
 * `hasHighSeverityBreak` responde `false` ate o motor de conciliacao existir
 * (marco do worker). Isso e uma lacuna DECLARADA, nao um esquecimento: a regra
 * 5 esta implementada e testada, e passa a valer no dia em que houver breaks
 * para consultar. O contrario — deixar a regra de fora e "lembrar depois" — e
 * como uma regra de seguranca nunca chega.
 */
@Injectable()
export class DefaultBalanceSignals implements BalanceSignals {
  constructor(@Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository) {}

  async hasHighSeverityBreak(_environment: Environment, _accountId: string): Promise<boolean> {
    return false;
  }

  async lastKnownMovementAt(
    environment: Environment,
    accountId: string,
  ): Promise<Date | undefined> {
    const account = await this.accounts.findById(environment, accountId);
    return account?.lastEventAt ?? undefined;
  }
}
