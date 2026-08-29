import { CapabilityNotSupportedError, type CapabilityKey } from '@baasconn/taxonomy';
import { SupportLevel } from '@baasconn/taxonomy';
import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ProviderRegistry } from '../providers/provider.registry.js';

import type { AuthedRequest } from './api-key.guard.js';

export const CAPABILITY_KEY = 'baas:capability';

/** Capacidade fixa, ou derivada do corpo da requisicao. */
export type CapabilitySelector =
  | CapabilityKey
  | ((request: { body?: unknown; query?: unknown }) => CapabilityKey);

/**
 * Exige uma capacidade do provedor.
 *
 * Resolve o manifesto e devolve 501 ANTES de qualquer chamada de rede, com a
 * nota do manifesto explicando a limitacao. Sem isso, o cliente receberia um
 * erro opaco do provedor depois de um round-trip.
 *
 * Aceita uma FUNCAO quando a capacidade depende do pedido: criar conta e
 * `accounts.create.pf` ou `accounts.create.pj` conforme o titular. Fixar uma
 * das duas recusaria por engano uma conexao que suporta so a outra.
 */
export const RequiresCapability = (capability: CapabilitySelector) =>
  SetMetadata(CAPABILITY_KEY, capability);

@Injectable()
export class CapabilityGuard implements CanActivate {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const selector = this.reflector.getAllAndOverride<CapabilitySelector>(CAPABILITY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!selector) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const capability = typeof selector === 'function' ? selector(request) : selector;
    const connectionId = this.resolveConnectionId(request);
    if (!connectionId) return true;

    const entry = await this.registry.capabilityFor(connectionId, capability);
    if (entry.level === SupportLevel.UNSUPPORTED) {
      const slug = await this.registry.slugFor(connectionId);
      throw new CapabilityNotSupportedError(slug, capability, entry.note);
    }

    // PARTIAL e EMULATED nao sao erro, mas o cliente precisa poder registrar.
    if (entry.level !== SupportLevel.SUPPORTED) {
      const response = context
        .switchToHttp()
        .getResponse<{ setHeader(k: string, v: string): void }>();
      response.setHeader('X-Baas-Capability-Level', entry.level);
      if (entry.note) response.setHeader('X-Baas-Capability-Note', encodeURIComponent(entry.note));
    }

    return true;
  }

  private resolveConnectionId(request: AuthedRequest): string | undefined {
    const query = request.query as Record<string, unknown> | undefined;
    const body = request.body as Record<string, unknown> | undefined;
    return (
      (typeof query?.connection_id === 'string' ? query.connection_id : undefined) ??
      (typeof body?.connection_id === 'string' ? body.connection_id : undefined) ??
      request.apiKey?.defaultConnectionId
    );
  }
}
