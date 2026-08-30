import type { HttpClient } from '@baasconn/adapter-kit';
import type {
  AccountRef,
  CreateDynamicChargeInput,
  Page,
  Pagination,
  PixCharge,
  PixChargesFacet,
} from '@baasconn/provider-spi';
import { BaasError, BaasErrorCode, Money, PixChargeStatus } from '@baasconn/taxonomy';

import type { WvCharge, WvChargeList, WvChargeResponse } from '../dto/index.js';
import { paths } from '../endpoints.js';

const STATUS: Readonly<Record<string, PixChargeStatus>> = Object.freeze({
  ACTIVE: PixChargeStatus.ACTIVE,
  COMPLETED: PixChargeStatus.COMPLETED,
  EXPIRED: PixChargeStatus.EXPIRED,
});

export function buildPixChargesFacet(client: HttpClient): PixChargesFacet {
  return {
    async createDynamic(_ref: AccountRef, input: CreateDynamicChargeInput): Promise<PixCharge> {
      const response = await client.request<WvChargeResponse>({
        method: 'POST',
        path: paths.charge,
        body: {
          // `correlationID` E a chave de idempotencia da Woovi: repetir o mesmo
          // valor devolve a cobranca existente em vez de criar outra.
          correlationID: input.txid,
          // Centavos INTEIROS, nao decimal. A Woovi e o unico dos cinco
          // provedores que ja fala a mesma unidade que o nosso dominio.
          value: Number(Money.fromJSON(input.amount ?? Money.of(0n).toJSON()).cents),
          comment: input.payerRequest,
          expiresIn: input.expiresInSeconds,
        },
        idempotent: false,
        endpointClass: 'write',
      });

      return toCharge(response.body.charge);
    },

    async get(_ref: AccountRef, txid: string): Promise<PixCharge> {
      const response = await client.request<WvChargeResponse>({
        method: 'GET',
        path: `${paths.charge}/${encodeURIComponent(txid)}`,
        endpointClass: 'read',
      });
      return toCharge(response.body.charge);
    },

    async list(_ref: AccountRef, query: Pagination): Promise<Page<PixCharge>> {
      const response = await client.request<WvChargeList>({
        method: 'GET',
        path: paths.charge,
        query: { limit: query.limit, skip: query.cursor },
        endpointClass: 'read',
      });

      const charges = response.body.charges ?? [];
      const hasMore = response.body.pageInfo?.hasNextPage ?? charges.length === query.limit;

      return {
        data: charges.map(toCharge),
        hasMore,
        // A Woovi pagina por SKIP, nao por cursor. O adapter embute o proximo
        // offset no cursor opaco, entao o cliente do conector nunca ve a
        // diferenca — que e exatamente o que o SPI promete.
        nextCursor: hasMore ? String(Number(query.cursor ?? 0) + charges.length) : undefined,
      };
    },

    createStatic: (): Promise<PixCharge> =>
      Promise.reject(
        new BaasError(BaasErrorCode.CAPABILITY_NOT_SUPPORTED, {
          message: 'A Woovi nao expoe cobranca estatica na API publica.',
        }),
      ),
  };
}

function toCharge(charge: WvCharge): PixCharge {
  return {
    txid: charge.correlationID,
    kind: 'dynamic',
    status: STATUS[charge.status?.toUpperCase() ?? ''] ?? PixChargeStatus.ACTIVE,
    amount: Money.of(BigInt(charge.value)).toJSON(),
    emvPayload: charge.brCode,
    qrCodeImageUrl: charge.qrCodeImage,
    locationUrl: charge.paymentLinkUrl,
    expiresAt: charge.expiresDate,
    raw: charge,
  };
}
