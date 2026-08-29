import { zBalanceQuery } from '@baasconn/contracts';
import { getContext } from '@baasconn/observability';
import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';

import { actorOf } from '../accounts/accounts.controller.js';
import { Scopes, type AuthedRequest } from '../auth/api-key.guard.js';
import { RequiresCapability } from '../auth/capability.guard.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';

import { BalanceService } from './balance.service.js';

@Controller('v1/accounts')
export class BalanceController {
  constructor(private readonly balances: BalanceService) {}

  /**
   * Saldo da conta.
   *
   * A frescura vai no corpo E em cabecalhos. No corpo porque e parte do
   * contrato e um cliente que ignora headers ainda precisa saber; em
   * cabecalhos porque um proxy ou um painel de observabilidade consegue
   * agregar por eles sem parsear JSON.
   */
  @Get(':id/balance')
  @Scopes('balance:read')
  @RequiresCapability('balance.get')
  async get(
    @Param('id') accountId: string,
    @Query(new ZodValidationPipe(zBalanceQuery)) query: z.infer<typeof zBalanceQuery>,
    @Req() request: AuthedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const actor = actorOf(request);

    const result = await this.balances.get(actor, accountId, {
      consistency: query.consistency,
      source: query.source,
      onProviderError: query.on_provider_error,
    });

    response.setHeader('X-Baas-Data-Source', result.freshness.source);
    response.setHeader('X-Baas-Data-Age', String(result.freshness.age_ms));
    if (result.bypass) response.setHeader('X-Baas-Cache-Bypass', result.bypass);
    if (result.freshness.degraded) {
      // `Warning: 110` e o codigo HTTP para "resposta obsoleta". Serve stale
      // sem ele e servir stale em silencio.
      response.setHeader('Warning', '110 - "Response is stale"');
    }

    return {
      ...result.dto,
      _meta: {
        request_id: getContext()?.requestId ?? '',
        freshness: result.freshness,
      },
    };
  }
}
