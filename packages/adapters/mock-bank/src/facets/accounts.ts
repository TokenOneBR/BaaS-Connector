import type { HttpClient } from '@baasconn/adapter-kit';
import type {
  AccountRef,
  AccountsFacet,
  CreateAccountPFInput,
  CreateAccountPJInput,
  Page,
  Pagination,
  ProviderAccount,
} from '@baasconn/provider-spi';

import type { MbAccount, MbList } from '../dto/index.js';
import { toProviderAccount } from '../mappers/account.js';

export function buildAccountsFacet(client: HttpClient): AccountsFacet {
  const create = async (body: Record<string, unknown>): Promise<ProviderAccount> => {
    const response = await client.request<MbAccount>({
      method: 'POST',
      path: '/api/v1/contas',
      body,
      endpointClass: 'write',
    });
    return toProviderAccount(response.body);
  };

  return {
    async createPF(input: CreateAccountPFInput) {
      return create({
        tipo_pessoa: 'PF',
        documento: input.holder.taxId.value,
        nome: input.holder.fullName,
        email: input.holder.email,
        id_externo: input.externalId,
      });
    },

    async createPJ(input: CreateAccountPJInput) {
      return create({
        tipo_pessoa: 'PJ',
        documento: input.company.taxId.value,
        nome: input.company.legalName,
        email: input.company.email,
        id_externo: input.externalId,
      });
    },

    async get(ref: AccountRef) {
      const response = await client.request<MbAccount>({
        method: 'GET',
        path: `/api/v1/contas/${encodeURIComponent(ref.providerAccountId)}`,
        endpointClass: 'read',
      });
      return toProviderAccount(response.body);
    },

    async list(_query: Pagination): Promise<Page<ProviderAccount>> {
      const response = await client.request<MbList<MbAccount>>({
        method: 'GET',
        path: '/api/v1/contas',
        endpointClass: 'read',
      });
      // O Mock Bank nao pagina. Sintetizar um cursor falso daria ao chamador a
      // impressao de que ha mais paginas; `hasMore: false` e a verdade.
      return { data: response.body.dados.map(toProviderAccount), hasMore: false };
    },

    async updateStatus(ref: AccountRef, input: { blocked: boolean; reason?: string }) {
      const action = input.blocked ? 'bloquear' : 'desbloquear';
      const response = await client.request<MbAccount>({
        method: 'POST',
        path: `/api/v1/contas/${encodeURIComponent(ref.providerAccountId)}/${action}`,
        body: { motivo: input.reason },
        endpointClass: 'write',
      });
      return toProviderAccount(response.body);
    },

    async close(ref: AccountRef, input: { reason: string }) {
      const response = await client.request<MbAccount>({
        method: 'POST',
        path: `/api/v1/contas/${encodeURIComponent(ref.providerAccountId)}/encerrar`,
        body: { motivo: input.reason },
        endpointClass: 'write',
      });
      return toProviderAccount(response.body);
    },
  };
}
