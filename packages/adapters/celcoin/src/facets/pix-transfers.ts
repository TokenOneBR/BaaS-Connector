import type { HttpClient } from '@baasconn/adapter-kit';
import type {
  AccountRef,
  PixTransaction,
  PixTransfersFacet,
  SendPixInput,
} from '@baasconn/provider-spi';

import type { CcEnvelope, CcPixPayment } from '../dto/index.js';
import { paths } from '../endpoints.js';
import { toNumber } from '../mappers/money.js';
import { toPixTransaction } from '../mappers/pix.js';

export function buildPixTransfersFacet(client: HttpClient): PixTransfersFacet {
  return {
    async send(ref: AccountRef, input: SendPixInput): Promise<PixTransaction> {
      const response = await client.request<CcEnvelope<CcPixPayment>>({
        method: 'POST',
        path: paths.pixPayment,
        body: {
          amount: toNumber(input.amount),
          clientCode: input.idempotencyKey,
          debitParty: { account: ref.providerAccountId },
          creditParty: creditPartyOf(input),
          initiationType: initiationTypeOf(input),
          taxIdentifier: undefined,
          remittanceInformation: input.description,
        },
        // `idempotent: false` e a decisao mais importante deste arquivo. Um
        // POST que move dinheiro NAO pode ser retentado por timeout de corpo:
        // o kit converte isso em ProviderOutcomeUnknownError e a aplicacao
        // roda a reconsulta, em vez de pagar duas vezes.
        idempotent: false,
        idempotencyKey: input.idempotencyKey,
        endpointClass: 'write',
      });

      return toPixTransaction(response.body.body, 'out');
    },

    async get(ref: AccountRef, providerTransactionId: string): Promise<PixTransaction> {
      const response = await client.request<CcEnvelope<CcPixPayment>>({
        method: 'GET',
        path: paths.pixPayment,
        query: { id: providerTransactionId },
        endpointClass: 'read',
      });

      return toPixTransaction(response.body.body, 'out');
    },

    /**
     * Resolucao de desfecho desconhecido.
     *
     * A Celcoin ecoa o `clientCode` que mandamos, entao consultar por ele e o
     * caminho barato para descobrir se um pagamento cujo POST nao respondeu
     * chegou a existir. Sem isto, a escada do desfecho desconhecido nao teria
     * primeira tentativa e cairia direto na varredura de extrato.
     */
    async findByIdempotencyKey(_ref: AccountRef, key: string): Promise<PixTransaction | null> {
      const response = await client.request<CcEnvelope<CcPixPayment | null>>({
        method: 'GET',
        path: paths.pixPayment,
        query: { clientCode: key },
        endpointClass: 'read',
      });

      const body = response.body.body;
      return body ? toPixTransaction(body, 'out') : null;
    },
  };
}

function creditPartyOf(input: SendPixInput): Record<string, unknown> {
  const destination = input.destination;
  if (destination.kind === 'pix_key') return { key: destination.key };
  if (destination.kind === 'bank_account') {
    return {
      bank: destination.ispb,
      branch: destination.branch,
      account: destination.number,
      accountType: destination.accountType,
      taxId: destination.holder.taxId.value,
      name: destination.holder.name,
    };
  }
  // `emv` e `qr_code` sao normalizados para chave pelo conector antes de
  // chegarem ao adapter — se um chegar aqui, o contrato foi violado a montante.
  throw new TypeError(`Destino ${destination.kind} nao e aceito pela Celcoin.`);
}

function initiationTypeOf(input: SendPixInput): string {
  return input.destination.kind === 'pix_key' ? 'DICT' : 'MANUAL';
}
