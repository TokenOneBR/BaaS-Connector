import type { HttpClient } from '@baasconn/adapter-kit';
import type { AccountRef, BalanceFacet, ProviderBalance } from '@baasconn/provider-spi';

import type { CcBalance, CcEnvelope } from '../dto/index.js';
import { fromNumber, optionalFromNumber } from '../mappers/money.js';

export function buildBalanceFacet(client: HttpClient, clock: () => string): BalanceFacet {
  return {
    async get(ref: AccountRef): Promise<ProviderBalance> {
      const response = await client.request<CcEnvelope<CcBalance>>({
        method: 'GET',
        path: '/baas/v2/account/balance',
        query: { Account: ref.providerAccountId },
        endpointClass: 'read',
      });

      const body = response.body.body;
      return {
        available: fromNumber(body.amount),
        blocked: optionalFromNumber(body.blockedAmount),
        pending: optionalFromNumber(body.scheduledAmount),
        // A Celcoin nem sempre devolve `updatedAt`. Sem ele o conector nao tem
        // como julgar a frescura do saldo, e a regra 6 de bypass do cache
        // ficaria cega — entao o relogio INJETADO preenche, e nunca `Date.now`.
        asOf: body.updatedAt ?? clock(),
        raw: body,
      };
    },
  };
}
