import { enrichContext } from '@baasconn/observability';
import { BaasError, BaasErrorCode } from '@baasconn/taxonomy';
import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { RawBodyRequest } from '../common/raw-body.middleware.js';

import { ApiKeyService, type AuthenticatedKey } from './api-key.service.js';

export interface AuthedRequest extends RawBodyRequest {
  apiKey?: AuthenticatedKey;
}

export const SCOPES_KEY = 'baas:scopes';
export const REQUIRE_SIGNATURE_KEY = 'baas:requireSignature';
export const PUBLIC_KEY = 'baas:public';

export const Scopes = (...scopes: string[]) => SetMetadata(SCOPES_KEY, scopes);

/**
 * Marca uma rota como exigindo assinatura HMAC sempre.
 *
 * Aplicado em toda rota que move dinheiro. Uma chave de producao com
 * `pix:write` tem `signingRequired` forcado, mas o decorator garante a regra
 * mesmo se o registro da chave estiver errado.
 */
export const RequireSignature = () => SetMetadata(REQUIRE_SIGNATURE_KEY, true);

export const Public = () => SetMetadata(PUBLIC_KEY, true);

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly apiKeys: ApiKeyService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new BaasError(BaasErrorCode.AUTHENTICATION_FAILED, {
        message: 'Informe a chave de API no cabecalho Authorization: Bearer <chave>.',
      });
    }

    const rawKey = header.slice('Bearer '.length).trim();
    const key = await this.apiKeys.authenticate(rawKey, request.ip);
    request.apiKey = key;

    enrichContext({
      apiKeyId: key.id,
      environment: key.environment,
      actorType: 'API_KEY',
    });

    const routeRequiresSignature = this.reflector.getAllAndOverride<boolean>(REQUIRE_SIGNATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (routeRequiresSignature || key.signingRequired) {
      await this.apiKeys.verifySignature(key, {
        method: request.method,
        path: request.originalUrl,
        rawBody: request.rawBody?.toString('utf8') ?? JSON.stringify(request.body ?? {}),
        timestamp: String(request.headers['x-baas-timestamp'] ?? ''),
        nonce: String(request.headers['x-baas-nonce'] ?? ''),
        signature: String(request.headers['x-baas-signature'] ?? ''),
      });
    }

    const required = this.reflector.getAllAndOverride<string[]>(SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    for (const scope of required ?? []) this.apiKeys.assertScope(key, scope);

    return true;
  }
}
