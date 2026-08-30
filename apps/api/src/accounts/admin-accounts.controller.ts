import { AccountStatus, ActorType, HolderType, type Clock } from '@baasconn/taxonomy';
import { Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';

import { MinRole, type AdminRequest } from '../admin/admin-session.guard.js';
import { ConsoleEnvironmentPipe, type EnvironmentQuery } from '../admin/environment.query.js';
import { Public } from '../auth/api-key.guard.js';
import { CLOCK } from '../common/clock.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { AUDIT_REPOSITORY, type AuditRepository } from '../events/outbox.types.js';

import { toAccountDto } from './accounts.mapper.js';
import { AccountsService } from './accounts.service.js';

const zListQuery = z.object({
  status: z.nativeEnum(AccountStatus).optional(),
  holder_type: z.nativeEnum(HolderType).optional(),
  connection_id: z.string().optional(),
  external_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});

/**
 * Contas, para o console.
 *
 * NAO reusa `/v1/accounts`. Aquelas rotas sao guardadas por `@Scopes(...)` e o
 * `actorOf()` delas deriva ambiente, conexao e escopos de `request.apiKey`,
 * que e `undefined` numa requisicao de sessao. Dar uma API key de servico ao
 * BFF reintroduziria exatamente o caminho de escalada de privilegio que a
 * ADR 0006 proibe — e, pior, trocaria o ator humano de toda linha de auditoria
 * pelo id de uma chave compartilhada.
 */
@Controller('admin/v1/accounts')
@Public()
export class AdminAccountsController {
  constructor(
    private readonly accounts: AccountsService,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get()
  @MinRole('VIEWER')
  async list(
    @Query(ConsoleEnvironmentPipe) env: EnvironmentQuery,
    @Query(new ZodValidationPipe(zListQuery)) query: z.infer<typeof zListQuery>,
  ) {
    const page = await this.accounts.list({
      environment: env.environment,
      status: query.status,
      holderType: query.holder_type,
      connectionId: query.connection_id,
      externalId: query.external_id,
      limit: query.limit,
      cursor: query.cursor,
    });

    const data = await Promise.all(
      page.data.map(async (account) =>
        toAccountDto(account, await this.accounts.holderOf(env.environment, account.holderId)),
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
  @MinRole('VIEWER')
  async get(@Param('id') id: string, @Query(ConsoleEnvironmentPipe) env: EnvironmentQuery) {
    const account = await this.accounts.get(env.environment, id);
    const holder = await this.accounts.holderOf(env.environment, account.holderId);
    // Sempre MASCARADO nesta rota. Revelar e outra rota, com outro papel e
    // com auditoria — ver abaixo.
    return toAccountDto(account, holder);
  }

  /**
   * Revelar o documento e um POST, e nao um `GET ?unmask=true`.
   *
   * A rota de `/v1` usa uma flag de query, e para o console isso seria errado:
   * um GET e pre-carregavel pelo `next/link`, cacheavel e reexecutavel a
   * partir do historico do navegador. O console geraria linha de auditoria de
   * desmascaramento por uma pagina que o operador apenas passou o mouse por
   * cima.
   *
   * `COMPLIANCE`, porque e o papel que investiga — e todo uso e auditado, com
   * o ator sendo a PESSOA, nunca uma chave.
   */
  @Post(':id/tax-id/reveal')
  @HttpCode(200)
  @MinRole('COMPLIANCE')
  async reveal(
    @Param('id') id: string,
    @Query(ConsoleEnvironmentPipe) env: EnvironmentQuery,
    @Req() request: AdminRequest,
  ) {
    const account = await this.accounts.get(env.environment, id);
    const holder = await this.accounts.holderOf(env.environment, account.holderId);
    const plaintext = await this.accounts.revealTaxId(env.environment, holder.id);

    await this.audit.record({
      environment: env.environment,
      actorType: ActorType.USER,
      actorId: request.session!.userId,
      actorIp: request.ip,
      action: 'holder.tax_id.unmask',
      outcome: 'SUCCESS',
      resourceType: 'holder',
      resourceId: holder.id,
      after: { account_id: account.id },
      occurredAt: this.clock.now(),
    });

    return { holder_id: holder.id, tax_id: plaintext };
  }
}
