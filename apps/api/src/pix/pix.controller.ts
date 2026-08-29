import { zCreateCharge, zCreatePixKey, zResolvePixKeyQuery } from '@baasconn/contracts';
import { PixKeyType } from '@baasconn/taxonomy';
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';

import { actorOf } from '../accounts/accounts.controller.js';
import { Scopes, type AuthedRequest } from '../auth/api-key.guard.js';
import { RequiresCapability } from '../auth/capability.guard.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';

import { PixChargesService, toPixChargeDto } from './pix-charges.service.js';
import { PixKeysService, toPixKeyDto } from './pix-keys.service.js';

const zListLimit = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) });

@Controller('v1/accounts/:accountId/pix')
export class PixController {
  constructor(
    private readonly keys: PixKeysService,
    private readonly charges: PixChargesService,
  ) {}

  @Post('keys')
  @HttpCode(201)
  @Scopes('pix:keys:write')
  @RequiresCapability('pix.keys.create')
  async createKey(
    @Param('accountId') accountId: string,
    @Body(new ZodValidationPipe(zCreatePixKey)) body: z.infer<typeof zCreatePixKey>,
    @Req() request: AuthedRequest,
  ) {
    const key = await this.keys.create(actorOf(request), accountId, {
      type: body.type as PixKeyType,
      value: body.value,
    });
    return toPixKeyDto(key);
  }

  @Get('keys')
  @Scopes('pix:keys:read')
  async listKeys(@Param('accountId') accountId: string, @Req() request: AuthedRequest) {
    const actor = actorOf(request);
    const keys = await this.keys.list(actor.environment, accountId);
    return { object: 'list' as const, data: keys.map(toPixKeyDto) };
  }

  /**
   * Consulta DICT.
   *
   * Fica ANTES de `keys/:keyId` na declaracao: o Nest casa rotas na ordem em
   * que sao registradas, e `keys/resolve` seria capturado pelo parametro.
   */
  @Get('keys/resolve')
  @Scopes('pix:keys:read')
  @RequiresCapability('pix.keys.resolve')
  async resolveKey(
    @Param('accountId') accountId: string,
    @Query(new ZodValidationPipe(zResolvePixKeyQuery)) query: z.infer<typeof zResolvePixKeyQuery>,
    @Req() request: AuthedRequest,
  ) {
    const resolution = await this.keys.resolve(actorOf(request), accountId, query.key);
    return {
      key: resolution.key,
      key_type: resolution.keyType,
      // Documento de TERCEIRO: mascarado sempre, sem opcao de revelar. O
      // escopo pii:read cobre os nossos titulares, nao contrapartes.
      holder_name: resolution.holderName,
      holder_tax_id: `***${resolution.holderTaxId.value.slice(-4)}`,
      ispb: resolution.ispb,
      bank_name: resolution.bankName ?? null,
      branch: resolution.branch ?? null,
      account_number: resolution.accountNumber ?? null,
      account_type: resolution.accountType ?? null,
      resolved_at: new Date().toISOString(),
    };
  }

  @Delete('keys/:keyId')
  @HttpCode(204)
  @Scopes('pix:keys:write')
  @RequiresCapability('pix.keys.delete')
  async deleteKey(
    @Param('accountId') accountId: string,
    @Param('keyId') keyId: string,
    @Req() request: AuthedRequest,
  ) {
    await this.keys.remove(actorOf(request), accountId, keyId);
  }

  @Post('charges')
  @HttpCode(201)
  @Scopes('pix:write')
  async createCharge(
    @Param('accountId') accountId: string,
    @Body(new ZodValidationPipe(zCreateCharge)) body: z.infer<typeof zCreateCharge>,
    @Req() request: AuthedRequest,
  ) {
    const charge = await this.charges.create(actorOf(request), accountId, body);
    return toPixChargeDto(charge);
  }

  @Get('charges')
  @Scopes('pix:read')
  async listCharges(
    @Param('accountId') accountId: string,
    @Query(new ZodValidationPipe(zListLimit)) query: z.infer<typeof zListLimit>,
    @Req() request: AuthedRequest,
  ) {
    const actor = actorOf(request);
    const charges = await this.charges.list(actor.environment, accountId, query.limit);
    return { object: 'list' as const, data: charges.map(toPixChargeDto) };
  }

  @Get('charges/:txid')
  @Scopes('pix:read')
  async getCharge(
    @Param('accountId') accountId: string,
    @Param('txid') txid: string,
    @Req() request: AuthedRequest,
  ) {
    const actor = actorOf(request);
    return toPixChargeDto(await this.charges.get(actor.environment, accountId, txid));
  }

  @Post('charges/:txid/cancel')
  @HttpCode(200)
  @Scopes('pix:write')
  async cancelCharge(
    @Param('accountId') accountId: string,
    @Param('txid') txid: string,
    @Req() request: AuthedRequest,
  ) {
    return toPixChargeDto(await this.charges.cancel(actorOf(request), accountId, txid));
  }
}
