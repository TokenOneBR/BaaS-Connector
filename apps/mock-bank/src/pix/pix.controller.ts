import { Money, PixKeyType, MoneyJSON } from '@baasconn/taxonomy';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { BearerAuthGuard } from '../common/auth.guard.js';
import { MockClock } from '../common/clock.provider.js';
import type { MockCharge, MockPayment, MockPixKey } from '../common/store.js';

import { ChargesService } from './charges.service.js';
import { PaymentsService } from './payments.service.js';
import { PixKeysService } from './pix-keys.service.js';

function serializeKey(key: MockPixKey) {
  return {
    id: key.id,
    tipo: key.type,
    chave: key.value,
    situacao: key.status,
    criada_em: key.createdAt.toISOString(),
  };
}

function serializeCharge(charge: MockCharge) {
  return {
    txid: charge.txid,
    tipo: charge.kind === 'dynamic' ? 'DINAMICA' : 'ESTATICA',
    situacao: charge.status,
    valor: charge.amountCents ? Money.of(charge.amountCents).toDecimalString() : null,
    chave: charge.pixKey,
    emv: charge.emvPayload,
    expira_em: charge.expiresAt?.toISOString() ?? null,
    valor_pago: Money.of(charge.paidAmountCents).toDecimalString(),
    pago_em: charge.paidAt?.toISOString() ?? null,
    revisao: charge.revision,
    criada_em: charge.createdAt.toISOString(),
  };
}

function serializePayment(payment: MockPayment) {
  return {
    id: payment.id,
    conta_id: payment.accountId,
    tipo: payment.direction === 'in' ? 'CREDITO' : 'DEBITO',
    situacao: payment.status,
    valor: Money.of(payment.amountCents).toDecimalString(),
    tarifa: Money.of(payment.feeCents).toDecimalString(),
    end_to_end_id: payment.endToEndId ?? null,
    id_devolucao: payment.returnId ?? null,
    end_to_end_id_original: payment.originalEndToEndId ?? null,
    txid: payment.txid ?? null,
    contraparte: payment.counterparty,
    descricao: payment.description ?? null,
    data_movimento: payment.createdAt.toISOString(),
    data_liquidacao: payment.settledAt?.toISOString() ?? null,
  };
}

/** Converte o decimal do wire para centavos, exatamente. */
function toCents(decimal: string): bigint {
  return Money.fromDecimalString(decimal).cents;
}

@Controller('api/v1')
@UseGuards(BearerAuthGuard)
export class PixController {
  constructor(
    private readonly keys: PixKeysService,
    private readonly charges: ChargesService,
    private readonly payments: PaymentsService,
    private readonly clock: MockClock,
  ) {}

  // --------------------------- chaves ---------------------------

  @Post('contas/:id/chaves')
  createKey(@Param('id') accountId: string, @Body() body: { tipo: PixKeyType; chave?: string }) {
    return serializeKey(this.keys.create(accountId, body.tipo, body.chave));
  }

  @Get('contas/:id/chaves')
  listKeys(@Param('id') accountId: string) {
    return { dados: this.keys.list(accountId).map(serializeKey) };
  }

  @Delete('contas/:id/chaves/:chave')
  deleteKey(@Param('id') accountId: string, @Param('chave') key: string) {
    this.keys.remove(accountId, decodeURIComponent(key));
    return { removida: true };
  }

  @Get('dict/:chave')
  resolveKey(@Param('chave') key: string) {
    const resolution = this.keys.resolve(decodeURIComponent(key));
    return {
      chave: resolution.key.value,
      tipo: resolution.key.type,
      nome_titular: resolution.holderName,
      documento_titular: resolution.holderTaxId,
      ispb: resolution.ispb,
      agencia: resolution.branch,
      conta: resolution.accountNumber,
      consultado_em: this.clock.now().toISOString(),
    };
  }

  // --------------------------- cobrancas ---------------------------

  @Post('contas/:id/cobrancas')
  createCharge(
    @Param('id') accountId: string,
    @Body()
    body: {
      tipo: 'ESTATICA' | 'DINAMICA';
      chave: string;
      valor?: string;
      txid?: string;
      expiracao_segundos?: number;
      solicitacao_pagador?: string;
    },
  ) {
    const charge = this.charges.create({
      accountId,
      kind: body.tipo === 'DINAMICA' ? 'dynamic' : 'static',
      pixKey: body.chave,
      amountCents: body.valor ? toCents(body.valor) : undefined,
      txid: body.txid,
      expiresInSeconds: body.expiracao_segundos,
      payerRequest: body.solicitacao_pagador,
    });
    return serializeCharge(charge);
  }

  @Get('contas/:id/cobrancas')
  listCharges(@Param('id') accountId: string) {
    return { dados: this.charges.list(accountId).map(serializeCharge) };
  }

  @Get('cobrancas/:txid')
  getCharge(@Param('txid') txid: string) {
    return serializeCharge(this.charges.get(txid));
  }

  @Post('cobrancas/:txid/cancelar')
  cancelCharge(@Param('txid') txid: string) {
    return serializeCharge(this.charges.cancel(txid));
  }

  // --------------------------- movimentacao ---------------------------

  @Post('contas/:id/pix/enviar')
  async sendPix(
    @Param('id') accountId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body()
    body: {
      valor: string;
      chave?: string;
      conta_destino?: {
        ispb: string;
        agencia: string;
        conta: string;
        nome: string;
        documento: string;
      };
      descricao?: string;
    },
  ) {
    const destination = body.chave
      ? ({ kind: 'pix_key', key: body.chave } as const)
      : ({
          kind: 'bank_account',
          ispb: body.conta_destino!.ispb,
          branch: body.conta_destino!.agencia,
          number: body.conta_destino!.conta,
          holderName: body.conta_destino!.nome,
          holderTaxId: body.conta_destino!.documento,
        } as const);

    const payment = await this.payments.sendPix({
      accountId,
      amountCents: toCents(body.valor),
      idempotencyKey,
      description: body.descricao,
      destination,
    });
    return serializePayment(payment);
  }

  @Get('pix/:id')
  getPayment(@Param('id') id: string) {
    return serializePayment(this.payments.get(id));
  }

  /**
   * Busca pela chave de idempotencia do cliente.
   *
   * E o endpoint que permite ao conector resolver um desfecho desconhecido sem
   * reenviar o pagamento. Um provedor sem isto obriga o conector a escolher
   * entre arriscar pagamento duplo e deixar a transacao presa.
   */
  @Get('pix')
  findPayment(
    @Query('idempotency_key') idempotencyKey?: string,
    @Query('end_to_end_id') endToEndId?: string,
  ) {
    const payment = idempotencyKey
      ? this.payments.findByIdempotencyKey(idempotencyKey)
      : endToEndId
        ? this.payments.findByEndToEndId(endToEndId)
        : undefined;
    return { dados: payment ? serializePayment(payment) : null };
  }

  @Post('contas/:id/pix/devolver')
  async refund(
    @Param('id') accountId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body() body: { end_to_end_id_original: string; valor?: string; motivo: string },
  ) {
    const refund = await this.payments.refund({
      accountId,
      originalEndToEndId: body.end_to_end_id_original,
      amountCents: body.valor ? toCents(body.valor) : undefined,
      idempotencyKey,
      reasonCode: body.motivo,
    });
    return serializePayment(refund);
  }
}

export { serializePayment, serializeCharge, serializeKey };
export type { MoneyJSON };
