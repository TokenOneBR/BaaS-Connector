import type { HttpClient } from '@baasconn/adapter-kit';
import type {
  AccountRef,
  CreateRefundInput,
  PixDestination,
  PixRefund,
  PixTransaction,
  PixTransfersFacet,
  SendPixInput,
} from '@baasconn/provider-spi';
import { BaasError, BaasErrorCode } from '@baasconn/taxonomy';

import type { MbEnvelope, MbPayment } from '../dto/index.js';
import { toDecimal } from '../mappers/money.js';
import { toPixRefund, toPixTransaction } from '../mappers/pix.js';

/** Cabecalho de idempotencia do Mock Bank. */
const IDEMPOTENCY_HEADER = 'x-idempotency-key';

export function buildPixTransfersFacet(client: HttpClient): PixTransfersFacet {
  return {
    async send(ref: AccountRef, input: SendPixInput): Promise<PixTransaction> {
      const response = await client.request<MbPayment>({
        method: 'POST',
        path: `/api/v1/contas/${encodeURIComponent(ref.providerAccountId)}/pix/enviar`,
        body: {
          valor: toDecimal(input.amount),
          ...destinationBody(input.destination),
          descricao: input.description,
        },
        // A chave vai no cabecalho que o provedor entende. O valor e o nosso
        // operationId, nunca a Idempotency-Key do cliente: formatos arbitrarios
        // violam regra de provedor, e as vezes precisamos de uma SEGUNDA
        // chamada para a mesma chave do cliente.
        headers: { [IDEMPOTENCY_HEADER]: input.idempotencyKey },
        endpointClass: 'write',
      });
      return toPixTransaction(response.body);
    },

    async get(_ref: AccountRef, providerTransactionId: string): Promise<PixTransaction> {
      const response = await client.request<MbPayment>({
        method: 'GET',
        path: `/api/v1/pix/${encodeURIComponent(providerTransactionId)}`,
        endpointClass: 'read',
      });
      return toPixTransaction(response.body);
    },

    /**
     * Resolucao de desfecho desconhecido.
     *
     * Implementada mesmo com `idempotency.mode === 'header'` — a validacao de
     * boot so a EXIGE quando o provedor nao tem idempotencia nenhuma. Ela e o
     * caminho de conciliacao: apos um timeout, o worker pergunta ao provedor
     * pela nossa propria chave em vez de reenviar o pagamento.
     */
    async findByIdempotencyKey(_ref: AccountRef, key: string): Promise<PixTransaction | null> {
      const response = await client.request<MbEnvelope<MbPayment>>({
        method: 'GET',
        path: '/api/v1/pix',
        query: { idempotency_key: key },
        endpointClass: 'read',
      });
      return response.body.dados ? toPixTransaction(response.body.dados) : null;
    },

    async refund(ref: AccountRef, input: CreateRefundInput): Promise<PixRefund> {
      const response = await client.request<MbPayment>({
        method: 'POST',
        path: `/api/v1/contas/${encodeURIComponent(ref.providerAccountId)}/pix/devolver`,
        body: {
          end_to_end_id_original: input.originalEndToEndId,
          valor: input.amount ? toDecimal(input.amount) : undefined,
          motivo: input.reasonCode,
        },
        headers: { [IDEMPOTENCY_HEADER]: input.idempotencyKey },
        endpointClass: 'write',
      });
      return toPixRefund(response.body);
    },

    async getRefund(_ref: AccountRef, providerRefundId: string): Promise<PixRefund> {
      const response = await client.request<MbPayment>({
        method: 'GET',
        path: `/api/v1/pix/${encodeURIComponent(providerRefundId)}`,
        endpointClass: 'read',
      });
      return toPixRefund(response.body);
    },
  };
}

function destinationBody(destination: PixDestination): Record<string, unknown> {
  switch (destination.kind) {
    case 'pix_key':
      return { chave: destination.key };
    case 'bank_account':
      return {
        conta_destino: {
          ispb: destination.ispb,
          agencia: destination.branch,
          conta: destination.number,
          nome: destination.holder.name,
          documento: destination.holder.taxId.value,
        },
      };
    case 'emv':
    case 'qr_code':
      // O Mock Bank nao aceita copia e cola no envio; o manifesto declara
      // `pix.out.send` com `allowedPixKeyTypes`, e o core valida antes. Chegar
      // aqui e bug nosso, entao a mensagem diz o que fazer.
      throw new BaasError(BaasErrorCode.CAPABILITY_CONSTRAINT_VIOLATED, {
        message:
          'O Mock Bank so envia PIX por chave ou por dados bancarios. ' +
          'Parseie o copia e cola antes e envie a chave resultante.',
      });
  }
}
