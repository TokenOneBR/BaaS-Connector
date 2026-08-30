import { zApiKey, zApiKeyCreated, zCreateApiKey } from '@baasconn/contracts';
import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';

import { Public } from '../auth/api-key.guard.js';
import type { ApiKeyRecord } from '../auth/api-key.service.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';

import { MinRole, type AdminRequest } from './admin-session.guard.js';
import { ApiKeysService, type MintedApiKey } from './api-keys.service.js';
import { ConsoleEnvironmentPipe, type EnvironmentQuery } from './environment.query.js';
import { respond } from './respond.js';

/**
 * Chaves de API.
 *
 * NAO EXISTE, e nao pode passar a existir: `GET /api-keys/:id/secret`, nem
 * qualquer rota que devolva o segredo depois da criacao. Nao ha rotacao no
 * lugar — revogar e cunhar de novo e a unica. Uma rota de "rotacionar" seria
 * uma rota com segredo no corpo, que alguem eventualmente torna idempotente e
 * passa a repetir; a assimetria e deliberada.
 *
 * `ADMIN` em tudo. Uma API key alcanca dinheiro, e cunhar uma e a mesma classe
 * de acao que gravar credencial de provedor (ADR 0006).
 */
@Controller('admin/v1/api-keys')
@Public()
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @Get()
  @MinRole('ADMIN')
  async list(
    @Query(ConsoleEnvironmentPipe) query: EnvironmentQuery,
    @Query('status') status?: string,
  ) {
    const data = await this.keys.list(query.environment, status);
    return { object: 'list' as const, data: data.map(toDto) };
  }

  @Post()
  @MinRole('ADMIN')
  async create(
    @Body(new ZodValidationPipe(zCreateApiKey)) body: z.infer<typeof zCreateApiKey>,
    @Req() request: AdminRequest,
  ) {
    const minted = await this.keys.create({
      environment: body.environment,
      name: body.name,
      scopes: body.scopes,
      expiresAt: body.expires_at ? new Date(body.expires_at) : undefined,
      ipAllowlist: body.ip_allowlist,
      defaultConnectionId: body.default_connection_id ?? undefined,
      signingRequired: body.signing_required,
      actorId: request.session!.userId,
    });

    return toCreatedDto(minted);
  }

  @Post(':id/revoke')
  @MinRole('ADMIN')
  async revoke(
    @Param('id') id: string,
    @Query(ConsoleEnvironmentPipe) query: EnvironmentQuery,
    @Req() request: AdminRequest,
  ) {
    return toDto(await this.keys.revoke(query.environment, id, request.session!.userId));
  }
}

function toDto(key: ApiKeyRecord) {
  return respond(zApiKey, {
    id: key.id,
    name: key.name,
    environment: key.environment,
    prefix: key.prefix,
    last4: key.last4,
    scopes: key.scopes,
    signing_required: key.signingRequired,
    ip_allowlist: key.ipAllowlist,
    status: key.status,
    last_used_at: key.lastUsedAt?.toISOString() ?? null,
    expires_at: key.expiresAt?.toISOString() ?? null,
    created_at: key.createdAt.toISOString(),
  });
}

/**
 * A UNICA resposta do sistema que contem um segredo de API key.
 *
 * O contrato traz um `warning` literal, e ele nao e decorativo: e a copia
 * exata que a interface mostra ao lado do campo, e ter a frase no contrato
 * significa que console e SDK dizem a mesma coisa.
 */
function toCreatedDto(minted: MintedApiKey) {
  return respond(zApiKeyCreated, {
    ...toDto(minted.record),
    secret: minted.secret,
    signing_secret: minted.signingSecret ?? null,
    warning: 'Guarde esta chave agora: ela nao pode ser recuperada depois.',
  });
}
