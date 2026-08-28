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

    // O console e um BFF: o token chega em cookie httpOnly, nunca em JS do
    // browser. O header existe para ferramentas de linha de comando.
    const header = request.headers.authorization;
    const cookie = readCookie(request.headers.cookie, 'baas_session');
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : cookie;

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
