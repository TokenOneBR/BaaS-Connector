import { zCreateAccount, zListAccountsQuery, zUpdateAccountStatus } from '@baasconn/contracts';
import { EnvelopeCrypto } from '@baasconn/crypto';
import {
  ActorType,
  BaasError,
  BaasErrorCode,
  HolderType,
  type Environment,
} from '@baasconn/taxonomy';
import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { z } from 'zod';

import { Scopes, type AuthedRequest } from '../auth/api-key.guard.js';
import { RequiresCapability } from '../auth/capability.guard.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { AUDIT_REPOSITORY, type AuditRepository } from '../events/outbox.types.js';
import { Idempotent } from '../idempotency/idempotency.interceptor.js';

import { toAccountDto } from './accounts.mapper.js';
import { AccountsService, type ActorContext } from './accounts.service.js';

const zCloseBody = z.object({ reason: z.string().max(512).optional() });

@Controller('v1/accounts')
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly crypto: EnvelopeCrypto,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
  ) {}

  /**
   * Cria conta PF ou PJ.
   *
   * `accounts.create` esta na lista de classes com idempotencia OBRIGATORIA:
   * duas contas para o mesmo CPF nao e inconveniencia, e incidente de
   * compliance. O TTL do registro e de 7 dias pelo mesmo motivo.
   */
  @Post()
  @HttpCode(201)
  @Scopes('accounts:write')
  @Idempotent({ operationClass: 'accounts.create' })
  // A capacidade depende do titular: PF e PJ sao capacidades diferentes, e uma
  // conexao pode suportar so uma delas. Fixar `pj` recusaria por engano a
  // criacao de conta PF numa conexao que so faz PF.
  @RequiresCapability((request) =>
    (request.body as { holder?: { type?: string } } | undefined)?.holder?.type ===
    HolderType.INDIVIDUAL
      ? 'accounts.create.pf'
      : 'accounts.create.pj',
  )
  async create(
    @Body(new ZodValidationPipe(zCreateAccount)) body: z.infer<typeof zCreateAccount>,
    @Req() request: AuthedRequest,
  ) {
    const actor = actorOf(request);
    const account = await this.accounts.create(body, actor);
    const holder = await this.accounts.holderOf(actor.environment, account.holderId);
    return toAccountDto(account, holder);
  }

  @Get()
  @Scopes('accounts:read')
  async list(
    @Query(new ZodValidationPipe(zListAccountsQuery)) query: z.infer<typeof zListAccountsQuery>,
    @Req() request: AuthedRequest,
  ) {
    const actor = actorOf(request);
    const page = await this.accounts.list({
      environment: actor.environment,
      status: query.status,
      holderType: query.holder_type,
      externalId: query.external_id,
      limit: query.limit,
      cursor: query.cursor,
    });

    const data = await Promise.all(
      page.data.map(async (account) =>
        toAccountDto(account, await this.accounts.holderOf(actor.environment, account.holderId)),
      ),
    );

    return {
      object: 'list' as const,
      data,
      page: {
        has_more: page.nextCursor !== undefined,
        next_cursor: page.nextCursor ?? null,
        prev_cursor: null,
        limit: query.limit,
      },
    };
  }

  @Get(':id')
  @Scopes('accounts:read')
  async get(
    @Param('id') id: string,
    @Query('unmask') unmask: string | undefined,
    @Req() request: AuthedRequest,
  ) {
    const actor = actorOf(request);
    const account = await this.accounts.get(actor.environment, id);
    const holder = await this.accounts.holderOf(actor.environment, account.holderId);

    return toAccountDto(account, holder, {
      unmaskedTaxId:
        unmask === 'true' ? await this.unmask(actor, holder.id, account.id) : undefined,
    });
  }

  @Post(':id/block')
  @HttpCode(200)
  @Scopes('accounts:write')
  @RequiresCapability('accounts.updateStatus')
  async block(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zUpdateAccountStatus)) body: z.infer<typeof zUpdateAccountStatus>,
    @Req() request: AuthedRequest,
  ) {
    return this.changeStatus(id, 'block', body.reason, request);
  }

  @Post(':id/unblock')
  @HttpCode(200)
  @Scopes('accounts:write')
  @RequiresCapability('accounts.updateStatus')
  async unblock(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zUpdateAccountStatus)) body: z.infer<typeof zUpdateAccountStatus>,
    @Req() request: AuthedRequest,
  ) {
    return this.changeStatus(id, 'unblock', body.reason, request);
  }

  @Post(':id/close')
  @HttpCode(200)
  @Scopes('accounts:close')
  @RequiresCapability('accounts.close')
  async close(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zCloseBody)) body: z.infer<typeof zCloseBody>,
    @Req() request: AuthedRequest,
  ) {
    return this.changeStatus(id, 'close', body.reason, request);
  }

  private async changeStatus(
    id: string,
    action: 'block' | 'unblock' | 'close',
    reason: string | undefined,
    request: AuthedRequest,
  ) {
    const actor = actorOf(request);
    const account = await this.accounts.changeStatus(actor.environment, id, action, reason, actor);
    const holder = await this.accounts.holderOf(actor.environment, account.holderId);
    return toAccountDto(account, holder);
  }

  /**
   * Revela o documento completo.
   *
   * Exige `pii:read` e AUDITA cada uso. Sem a linha de auditoria, o escopo
   * seria so uma trava — com ela, e possivel responder "quem viu o CPF deste
   * cliente, e quando", que e o que a LGPD cobra.
   */
  private async unmask(actor: ActorContext, holderId: string, accountId: string): Promise<string> {
    if (!actor.scopes.includes('pii:read')) {
      throw new BaasError(BaasErrorCode.INSUFFICIENT_SCOPE, {
        message: "Revelar o documento exige o escopo 'pii:read'.",
        meta: { required: 'pii:read' },
      });
    }

    const plaintext = await this.accounts.revealTaxId(actor.environment, holderId);

    await this.audit.record({
      environment: actor.environment,
      actorType: ActorType.API_KEY,
      actorId: actor.apiKeyId,
      actorIp: actor.ip,
      action: 'holder.tax_id.unmask',
      outcome: 'SUCCESS',
      resourceType: 'holder',
      resourceId: holderId,
      after: { account_id: accountId },
      requestId: actor.requestId,
      occurredAt: new Date(),
    });

    return plaintext;
  }
}

export function actorOf(request: AuthedRequest): ActorContext {
  const apiKey = request.apiKey;
  if (!apiKey) throw new BaasError(BaasErrorCode.AUTHENTICATION_FAILED);

  const connectionId =
    (typeof request.query?.connection_id === 'string' ? request.query.connection_id : undefined) ??
    (request.body as { connection_id?: string } | undefined)?.connection_id ??
    apiKey.defaultConnectionId;

  if (!connectionId) {
    throw new BaasError(BaasErrorCode.CONNECTION_NOT_FOUND, {
      message:
        'Nenhuma conexao de provedor informada e a chave de API nao tem conexao padrao. ' +
        'Informe connection_id ou configure a conexao padrao da chave.',
    });
  }

  return {
    environment: apiKey.environment as Environment,
    connectionId,
    apiKeyId: apiKey.id,
    scopes: apiKey.scopes,
    requestId: (request.headers['x-request-id'] as string | undefined) ?? undefined,
    operationId: (request as { operationId?: string }).operationId,
    ip: request.ip,
  };
}
