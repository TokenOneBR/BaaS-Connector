import type { HttpClient } from '@baasconn/adapter-kit';
import type {
  AccountRef,
  BalanceFacet,
  PixKey,
  PixKeysFacet,
  PixKeyResolution,
  ProviderBalance,
} from '@baasconn/provider-spi';
import { BaasError, BaasErrorCode, Money, PixKeyType } from '@baasconn/taxonomy';

import type { AsBalance, AsPixKey, AsPixKeyList } from '../dto/index.js';
import { paths } from '../endpoints.js';

export function buildBalanceFacet(client: HttpClient, now: () => string): BalanceFacet {
  return {
    async get(): Promise<ProviderBalance> {
      const response = await client.request<AsBalance>({
        method: 'GET',
        path: paths.balance,
        endpointClass: 'read',
      });

      return {
        available: Money.of(BigInt(Math.round(response.body.balance * 100))).toJSON(),
        // `blocked` e `pending` saem AUSENTES, nao zerados. Zero afirmaria que
        // nao ha valor bloqueado; ausente diz que nao sabemos — e a diferenca
        // aparece na conciliacao, que trata ausente como "nao comparar".
        asOf: now(),
        raw: response.body,
      };
    },
  };
}

const KEY_TYPE: Readonly<Record<string, PixKeyType>> = Object.freeze({
  CPF: PixKeyType.CPF,
  CNPJ: PixKeyType.CNPJ,
  EMAIL: PixKeyType.EMAIL,
  PHONE: PixKeyType.PHONE,
  EVP: PixKeyType.EVP,
});

export function buildPixKeysFacet(client: HttpClient): PixKeysFacet {
  return {
    async create(_ref: AccountRef, input: { type: string }): Promise<PixKey> {
      if (input.type !== 'EVP') {
        throw new BaasError(BaasErrorCode.CAPABILITY_NOT_SUPPORTED, {
          message:
            'A API publica do Asaas so cria chave aleatoria (EVP); as demais sao cadastradas pelo painel.',
        });
      }

      const response = await client.request<AsPixKey>({
        method: 'POST',
        path: paths.pixKey,
        body: { type: 'EVP' },
        idempotent: false,
        endpointClass: 'write',
      });

      return toPixKey(response.body);
    },

    async list(): Promise<PixKey[]> {
      const response = await client.request<AsPixKeyList>({
        method: 'GET',
        path: paths.pixKey,
        endpointClass: 'read',
      });
      return (response.body.data ?? []).map(toPixKey);
    },

    async delete(_ref: AccountRef, key: string): Promise<void> {
      await client.request({
        method: 'DELETE',
        path: `${paths.pixKey}/${encodeURIComponent(key)}`,
        endpointClass: 'write',
      });
    },

    resolve: (): Promise<PixKeyResolution> =>
      Promise.reject(
        new BaasError(BaasErrorCode.CAPABILITY_NOT_SUPPORTED, {
          message: 'O Asaas nao expoe consulta ao DICT na API publica.',
        }),
      ),
  };
}

function toPixKey(key: AsPixKey): PixKey {
  return {
    providerKeyId: key.id,
    type: KEY_TYPE[key.type?.toUpperCase() ?? ''] ?? PixKeyType.EVP,
    value: key.key,
    status: key.status,
    requestedAt: key.dateCreated,
    activatedAt: key.status === 'ACTIVE' ? key.dateCreated : undefined,
    raw: key,
  };
}
