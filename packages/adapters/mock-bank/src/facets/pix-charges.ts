import type { HttpClient } from '@baasconn/adapter-kit';
import type {
  AccountRef,
  CreateDynamicChargeInput,
  CreateStaticChargeInput,
  Page,
  Pagination,
  PixCharge,
  PixChargesFacet,
} from '@baasconn/provider-spi';

import type { MbCharge, MbList } from '../dto/index.js';
import { toDecimal } from '../mappers/money.js';
import { toPixCharge } from '../mappers/pix.js';

export function buildPixChargesFacet(client: HttpClient): PixChargesFacet {
  const create = async (ref: AccountRef, body: Record<string, unknown>): Promise<PixCharge> => {
    const response = await client.request<MbCharge>({
      method: 'POST',
      path: `/api/v1/contas/${encodeURIComponent(ref.providerAccountId)}/cobrancas`,
      body,
      endpointClass: 'write',
    });
    return toPixCharge(response.body);
  };

  return {
    async createStatic(ref: AccountRef, input: CreateStaticChargeInput) {
      return create(ref, {
        tipo: 'ESTATICA',
        chave: input.pixKey,
        valor: input.amount ? toDecimal(input.amount) : undefined,
        txid: input.txid,
        solicitacao_pagador: input.payerRequest,
      });
    },

    async createDynamic(ref: AccountRef, input: CreateDynamicChargeInput) {
      return create(ref, {
        tipo: 'DINAMICA',
        chave: input.pixKey,
        valor: input.amount ? toDecimal(input.amount) : undefined,
        txid: input.txid,
        solicitacao_pagador: input.payerRequest,
        expiracao_segundos: input.expiresInSeconds,
      });
    },

    async get(_ref: AccountRef, txid: string) {
      const response = await client.request<MbCharge>({
        method: 'GET',
        path: `/api/v1/cobrancas/${encodeURIComponent(txid)}`,
        endpointClass: 'read',
      });
      return toPixCharge(response.body);
    },

    async list(ref: AccountRef, _query: Pagination): Promise<Page<PixCharge>> {
      const response = await client.request<MbList<MbCharge>>({
        method: 'GET',
        path: `/api/v1/contas/${encodeURIComponent(ref.providerAccountId)}/cobrancas`,
        endpointClass: 'read',
      });
      return { data: response.body.dados.map(toPixCharge), hasMore: false };
    },

    async cancel(_ref: AccountRef, txid: string) {
      const response = await client.request<MbCharge>({
        method: 'POST',
        path: `/api/v1/cobrancas/${encodeURIComponent(txid)}/cancelar`,
        endpointClass: 'write',
      });
      return toPixCharge(response.body);
    },
  };
}
