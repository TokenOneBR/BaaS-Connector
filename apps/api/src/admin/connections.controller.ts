import { zConnection, zCreateConnection, zHealthReport } from '@baasconn/contracts';
import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { z } from 'zod';

import { Public } from '../auth/api-key.guard.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { ApiConfig } from '../config/config.service.js';
import type { ConnectionSummary } from '../providers/credential.resolver.js';
import { ProviderResolver } from '../providers/provider.resolver.js';

import { MinRole, type AdminRequest } from './admin-session.guard.js';
import { ConnectionsService } from './connections.service.js';
import { ConsoleEnvironmentPipe, type EnvironmentQuery } from './environment.query.js';
import { respond } from './respond.js';

const zRotateCredentials = z.object({
  credentials: z.record(z.string(), z.unknown()),
  webhook_secret: z.string().min(1).optional(),
});

const zPatchConnection = z.object({
  label: z.string().max(64).optional(),
  base_url: z.string().url().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(['ACTIVE', 'DEGRADED', 'DISABLED']).optional(),
});

/**
 * Conexoes de provedor.
 *
 * NAO EXISTE, e nao pode passar a existir:
 *   GET /connections/:id/credentials
 *   GET /connections/:id/webhook-secret
 *   qualquer `?reveal=` numa rota de leitura
 *
 * A garantia nao depende deste comentario. `ConnectionSummary` nao tem campo
 * de ciphertext, o `select` do Prisma nao le as colunas, e `respond` limita a
 * resposta ao contrato — que tambem nao declara nenhum valor de credencial.
 * Sao tres camadas independentes, e a mais forte e a primeira: o controller
 * literalmente nao consegue escrever o vazamento.
 */
@Controller('admin/v1/connections')
@Public()
export class ConnectionsController {
  constructor(
    private readonly connections: ConnectionsService,
    private readonly providers: ProviderResolver,
    private readonly config: ApiConfig,
  ) {}

  /**
   * VIEWER, e nao OPERATOR.
   *
   * `COMPLIANCE` tem posto ABAIXO de `OPERATOR`, e a tela de conciliacao
   * precisa do filtro de conexao. Marcar esta leitura como OPERATOR trancaria
   * justamente o papel que existe para olhar divergencia de dinheiro.
   */
  @Get()
  @MinRole('VIEWER')
  async list(@Query(ConsoleEnvironmentPipe) query: EnvironmentQuery) {
    const data = await this.connections.list(query.environment);
    return { object: 'list' as const, data: data.map((row) => this.dto(row)) };
  }

  @Get(':id')
  @MinRole('COMPLIANCE')
  async get(@Param('id') id: string, @Query(ConsoleEnvironmentPipe) query: EnvironmentQuery) {
    return this.dto(await this.connections.get(query.environment, id));
  }

  @Post()
  @MinRole('ADMIN')
  async create(
    @Body(new ZodValidationPipe(zCreateConnection)) body: z.infer<typeof zCreateConnection>,
    @Req() request: AdminRequest,
  ) {
    return this.dto(
      await this.connections.create({
        environment: body.environment,
        provider: body.provider,
        label: body.label,
        baseUrl: body.base_url ?? undefined,
        config: body.config,
        credentials: body.credentials,
        webhookSecret: body.webhook_secret ?? undefined,
        actorId: request.session!.userId,
      }),
    );
  }

  /**
   * Rotacao, separada do PATCH de propósito.
   *
   * A acao auditada e outra (`credentials.rotated` vs `updated`), o corpo e
   * outro, e o efeito colateral e outro: invalida a DEK em cache. Espremer os
   * dois numa rota so faria a auditoria perder a distincao que importa.
   */
  @Put(':id/credentials')
  @MinRole('ADMIN')
  async rotate(
    @Param('id') id: string,
    @Query(ConsoleEnvironmentPipe) query: EnvironmentQuery,
    @Body(new ZodValidationPipe(zRotateCredentials)) body: z.infer<typeof zRotateCredentials>,
    @Req() request: AdminRequest,
  ) {
    return this.dto(
      await this.connections.rotateCredentials({
        environment: query.environment,
        id,
        credentials: body.credentials,
        webhookSecret: body.webhook_secret,
        actorId: request.session!.userId,
      }),
    );
  }

  @Patch(':id')
  @MinRole('ADMIN')
  async patch(
    @Param('id') id: string,
    @Query(ConsoleEnvironmentPipe) query: EnvironmentQuery,
    @Body(new ZodValidationPipe(zPatchConnection)) body: z.infer<typeof zPatchConnection>,
    @Req() request: AdminRequest,
  ) {
    return this.dto(
      await this.connections.updateSettings({
        environment: query.environment,
        id,
        label: body.label,
        baseUrl: body.base_url,
        config: body.config,
        status: body.status,
        actorId: request.session!.userId,
      }),
    );
  }

  /**
   * Sonda a conexao contra o provedor.
   *
   * Nunca entra no readiness do Kubernetes: a Celcoin ter uma tarde ruim nao
   * pode tirar nossos pods de servico. E uma leitura sob demanda do painel.
   */
  private dto(connection: ConnectionSummary) {
    return toConnectionDto(connection, this.config.publicBaseUrl);
  }

  @Post(':id/health')
  @MinRole('COMPLIANCE')
  async health(@Param('id') id: string, @Query(ConsoleEnvironmentPipe) query: EnvironmentQuery) {
    const conexao = await this.connections.get(query.environment, id);
    const bound = await this.providers.resolve(conexao.id);
    const report = await bound.adapter.health();
    return respond(zHealthReport, {
      healthy: report.healthy,
      checked_at: report.checkedAt,
      latency_ms: report.latencyMs ?? null,
      error_code: null,
      message: report.message ?? null,
    });
  }
}

/**
 * A URL que o PROVEDOR deve chamar.
 *
 * Derivada, e nao guardada: uma coluna com a URL ficaria errada no dia em que
 * o deploy mudasse de dominio, e o sintoma seria webhook perdido em silencio.
 * O `connectionId` vai no caminho porque, com uma conexao por ambiente por
 * provedor, o slug sozinho nao distingue homologacao de producao — e adivinhar
 * pelo payload e fragil.
 */
function toConnectionDto(connection: ConnectionSummary, publicBaseUrl: string) {
  return respond(zConnection, {
    id: connection.id,
    provider: connection.provider,
    environment: connection.environment,
    label: connection.label,
    status: connection.status,
    base_url: connection.baseUrl ?? null,
    // Prova de que ha credencial, nunca o valor. Nao existe schema neste
    // repositorio que aceite um valor de credencial na LEITURA, e e assim
    // que tem de continuar.
    credentials: {
      set: connection.credentials.set,
      fingerprint: connection.credentials.fingerprint ?? null,
      last4: connection.credentials.last4 ?? null,
      updated_at: connection.credentials.updatedAt?.toISOString() ?? null,
      updated_by: connection.credentials.updatedBy ?? null,
      expires_at: null,
    },
    webhook_url: `${publicBaseUrl}/webhooks/${connection.provider.toLowerCase()}/${connection.id}`,
    last_health_check_at: connection.lastHealthCheckAt?.toISOString() ?? null,
    last_health_status: connection.lastHealthStatus ?? null,
    created_at: connection.createdAt.toISOString(),
  });
}
