import { CapabilityNotSupportedError, type CapabilityKey } from '@baasconn/taxonomy';
import { SupportLevel } from '@baasconn/taxonomy';
import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ProviderRegistry } from '../providers/provider.registry.js';

import type { AuthedRequest } from './api-key.guard.js';

export const CAPABILITY_KEY = 'baas:capability';

/**
 * Exige uma capacidade do provedor.
 *
 * Resolve o manifesto e devolve 501 ANTES de qualquer chamada de rede, com a
 * nota do manifesto explicando a limitacao. Sem isso, o cliente receberia um
 * erro opaco do provedor depois de um round-trip.
 */
export const RequiresCapability = (capability: CapabilityKey) =>
  SetMetadata(CAPABILITY_KEY, capability);

@Injectable()
export class CapabilityGuard implements CanActivate {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const capability = this.reflector.getAllAndOverride<CapabilityKey>(CAPABILITY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!capability) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
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
