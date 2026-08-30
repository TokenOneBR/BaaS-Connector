import type { HttpClient } from '@baasconn/adapter-kit';
import type { AccountRef, PixKey, PixKeyResolution, PixKeysFacet } from '@baasconn/provider-spi';

import type { CcDictEntry, CcEnvelope } from '../dto/index.js';
import { paths } from '../endpoints.js';
import { toPixKey, toPixKeyResolution } from '../mappers/pix.js';

export function buildPixKeysFacet(client: HttpClient): PixKeysFacet {
  return {
    async create(ref: AccountRef, input: { type: string; value?: string }): Promise<PixKey> {
      const response = await client.request<CcEnvelope<CcDictEntry>>({
        method: 'POST',
        path: paths.dictEntry,
        // `EVP` e a unica em que o valor e do BACEN, nao nosso: mandar `key`
        // numa EVP faz a Celcoin recusar.
        body: {
          key: input.type === 'EVP' ? undefined : input.value,
          keyType: input.type === 'EMAIL' ? 'MAIL' : input.type,
          account: ref.providerAccountId,
        },
        endpointClass: 'write',
      });

      return toPixKey(response.body.body);
    },

    async list(ref: AccountRef): Promise<PixKey[]> {
      const response = await client.request<CcEnvelope<{ listKeys?: CcDictEntry[] }>>({
        method: 'GET',
        path: paths.dictEntry,
        query: { Account: ref.providerAccountId },
        endpointClass: 'read',
      });

      return (response.body.body.listKeys ?? []).map(toPixKey);
    },

    async delete(ref: AccountRef, key: string): Promise<void> {
      await client.request({
        method: 'DELETE',
        path: paths.dictEntry,
        body: { key, account: ref.providerAccountId },
        endpointClass: 'write',
      });
    },

    async resolve(ref: AccountRef, key: string): Promise<PixKeyResolution> {
      const response = await client.request<CcEnvelope<CcDictEntry>>({
        method: 'GET',
        path: `${paths.dictExternal}/${encodeURIComponent(ref.providerAccountId)}`,
        query: { key },
        endpointClass: 'read',
      });

      return toPixKeyResolution(response.body.body);
    },
  };
}
