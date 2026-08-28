import type { HttpClient } from '@baasconn/adapter-kit';
import type { AccountRef, PixKey, PixKeysFacet, PixKeyResolution } from '@baasconn/provider-spi';

import type { MbDictEntry, MbList, MbPixKey } from '../dto/index.js';
import { toPixKey, toPixKeyResolution } from '../mappers/pix.js';

export function buildPixKeysFacet(client: HttpClient): PixKeysFacet {
  return {
    async create(ref: AccountRef, input: { type: string; value?: string }): Promise<PixKey> {
      const response = await client.request<MbPixKey>({
        method: 'POST',
        path: `/api/v1/contas/${encodeURIComponent(ref.providerAccountId)}/chaves`,
        body: { tipo: input.type, chave: input.value },
        endpointClass: 'write',
      });
      return toPixKey(response.body);
    },

    async list(ref: AccountRef): Promise<PixKey[]> {
      const response = await client.request<MbList<MbPixKey>>({
        method: 'GET',
        path: `/api/v1/contas/${encodeURIComponent(ref.providerAccountId)}/chaves`,
        endpointClass: 'read',
      });
      return response.body.dados.map(toPixKey);
    },

    async delete(ref: AccountRef, key: string): Promise<void> {
      await client.request({
        method: 'DELETE',
        path: `/api/v1/contas/${encodeURIComponent(ref.providerAccountId)}/chaves/${encodeURIComponent(key)}`,
        endpointClass: 'write',
      });
    },

    async resolve(_ref: AccountRef, key: string): Promise<PixKeyResolution> {
      const response = await client.request<MbDictEntry>({
        method: 'GET',
        path: `/api/v1/dict/${encodeURIComponent(key)}`,
        endpointClass: 'read',
      });
      return toPixKeyResolution(response.body);
    },
  };
}
