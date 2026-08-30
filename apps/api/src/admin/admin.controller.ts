import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { z } from 'zod';

import { Public } from '../auth/api-key.guard.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { ApiConfig } from '../config/config.service.js';
import { ProviderRegistry } from '../providers/provider.registry.js';

import { AdminAuthService } from './admin-auth.service.js';
import { MinRole, type AdminRequest } from './admin-session.guard.js';

const zLogin = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totp_code: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});

const zRefresh = z.object({ refresh_token: z.string().min(16) });

/**
 * API do console.
 *
 * Fora do `/v1` e com autenticacao propria: uma API key NUNCA pode cunhar
 * outra chave nem gravar credencial de provedor. Sem essa separacao, uma chave
 * de integracao vazada escala privilegio ate a configuracao do conector.
 *
 * `@Public()` desliga o guard de API key para todo o controller; a autorizacao
 * vem do `AdminSessionGuard` nas rotas que a exigem.
 */
@Controller('admin/v1')
@Public()
export class AdminController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly registry: ProviderRegistry,
    private readonly config: ApiConfig,
  ) {}

  @Post('auth/login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(zLogin)) body: z.infer<typeof zLogin>,
    @Req() request: AdminRequest,
  ) {
    const issued = await this.auth.login({
      email: body.email,
      password: body.password,
      totpCode: body.totp_code,
      userAgent: request.headers['user-agent'],
      ipAddress: request.ip,
    });

    return toSessionResponse(issued);
  }

  @Post('auth/refresh')
  @HttpCode(200)
  async refresh(@Body(new ZodValidationPipe(zRefresh)) body: z.infer<typeof zRefresh>) {
    return toSessionResponse(await this.auth.refresh(body.refresh_token));
  }

  @Post('auth/logout')
  @HttpCode(204)
  async logout(@Req() request: AdminRequest): Promise<void> {
    await this.auth.logout(request.session!.sessionId);
  }

  @Get('me')
  me(@Req() request: AdminRequest) {
    const session = request.session!;
    return {
      user_id: session.userId,
      email: session.email,
      role: session.role,
      session_id: session.sessionId,
    };
  }

  /**
   * Provedores compilados neste deploy, com o manifesto de capacidades.
   *
   * Exige OPERATOR: a matriz revela quais BaaS a organizacao integra, que e
   * informacao comercial.
   */
  @Get('providers')
  @MinRole('OPERATOR')
  providers() {
    return {
      data: this.registry.list().map((factory) => ({
        slug: factory.slug,
        environments: Object.keys(factory.endpoints),
        capabilities: factory.manifest,
      })),
    };
  }

  /**
   * Configuracao de runtime, sem segredo nenhum.
   *
   * Devolve apenas o que o console precisa para se orientar — ambientes
   * atendidos, driver de KMS em uso, versao do cache. Nenhum campo daqui pode
   * carregar valor de credencial: e a mesma regra que faz as credenciais de
   * provedor serem write-only.
   *
   * ADMIN porque revela a postura de seguranca do deploy.
   */
  @Get('config')
  @MinRole('ADMIN')
  runtimeConfig() {
    return {
      environments: this.config.environments,
      kms_driver: this.config.kmsDriver,
      cache_version: this.config.cacheVersion,
      balance_cache_ttl_seconds: this.config.balanceCacheTtlSeconds,
      signature_tolerance_seconds: this.config.signatureToleranceSeconds,
      providers_compiled: this.registry.list().length,
    };
  }
}

function toSessionResponse(issued: {
  accessToken: string;
  expiresInSeconds: number;
  refreshToken: string;
  user: { id: string; email: string; name: string; role: string };
}) {
  return {
    access_token: issued.accessToken,
    token_type: 'Bearer',
    expires_in: issued.expiresInSeconds,
    refresh_token: issued.refreshToken,
    user: {
      id: issued.user.id,
      email: issued.user.email,
      name: issued.user.name,
      role: issued.user.role,
    },
  };
}
