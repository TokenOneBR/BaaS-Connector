import type { HttpClient } from '@baasconn/adapter-kit';
import type { AccountRef, BalanceFacet, ProviderBalance } from '@baasconn/provider-spi';

import type { MbBalance } from '../dto/index.js';
import { fromDecimal } from '../mappers/money.js';

export function buildBalanceFacet(client: HttpClient): BalanceFacet {
  return {
    async get(ref: AccountRef): Promise<ProviderBalance> {
      const response = await client.request<MbBalance>({
        method: 'GET',
        path: `/api/v1/contas/${encodeURIComponent(ref.providerAccountId)}/saldo`,
        endpointClass: 'read',
      });

      return {
        // Decimal no REST. No webhook o mesmo valor vem em centavos — as duas
        // conversoes moram em mappers/money.ts, com nome que diz de onde veio.
        available: fromDecimal(response.body.saldo_disponivel),
        blocked: fromDecimal(response.body.saldo_bloqueado),
        pending: fromDecimal(response.body.saldo_a_liberar),
        asOf: response.body.consultado_em,
        raw: response.body,
      };
    },
  };
}
