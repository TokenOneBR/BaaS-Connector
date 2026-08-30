import { enrichContext } from '@baasconn/observability';
import { BaasError, BaasErrorCode } from '@baasconn/taxonomy';
import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthedRequest } from '../auth/api-key.guard.js';

import { AdminAuthService } from './admin-auth.service.js';
import { atLeast, type AdminSession, type ConsoleRole } from './admin.types.js';
import { AdminTokenService } from './token.service.js';

export const MIN_ROLE_KEY = 'baas:minRole';

/**
 * Papel minimo exigido pela rota.
 *
 * Minimo, e nao lista: uma lista obriga a lembrar de incluir OWNER em toda
 * rota nova, e esquecer disso e o modo de falha classico de RBAC feito a mao.
 */
export const MinRole = (role: ConsoleRole) => SetMetadata(MIN_ROLE_KEY, role);

export interface AdminRequest extends AuthedRequest {
  session?: AdminSession;
}

@Injectable()
export class AdminSessionGuard implements CanActivate {
  constructor(
    private readonly tokens: AdminTokenService,
    private readonly auth: AdminAuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();

    // SO `Authorization: Bearer`. O ramo que aceitava um cookie `baas_session`
    // saiu: nada no repositorio jamais escreveu esse cookie, entao era codigo
    // morto — mas codigo morto que ANUNCIA "aceitamos cookie aqui", numa
    // superficie que grava credencial de provedor e cunha API key e que nao
    // tem CSRF nenhum. Com `enableCors({ credentials: true })` ja ligado, o
    // dia em que alguem expusesse `/admin/v1` num ingress e algo passasse a
    // escrever o cookie, toda rota admin viraria alvo de CSRF.
    //
    // O BFF do console manda Bearer, e ferramentas de linha de comando tambem.
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : undefined;

    if (!token) {
      throw new BaasError(BaasErrorCode.AUTHENTICATION_FAILED, {
        message: 'Sessao de console ausente.',
      });
    }

    const session = this.tokens.verifyAccessToken(token);
    // Revogar sessao precisa ter efeito ANTES de o access token expirar.
    await this.auth.assertSessionAlive(session);

    request.session = session;
    enrichContext({ userId: session.userId, actorType: 'USER' });

    const minimum = this.reflector.getAllAndOverride<ConsoleRole>(MIN_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (minimum && !atLeast(session.role, minimum)) {
      throw new BaasError(BaasErrorCode.AUTHORIZATION_DENIED, {
        message: `Esta acao exige o papel ${minimum} ou superior.`,
        meta: { required: minimum, granted: session.role },
      });
    }

    return true;
  }
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return undefined;
}
