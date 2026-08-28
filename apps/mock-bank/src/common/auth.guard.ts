import { createHash, randomBytes } from 'node:crypto';

import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { MockBankConfig } from '../config/config.service.js';

import { MockClock } from './clock.provider.js';
import { MockBankError } from './errors.js';

interface IssuedToken {
  clientId: string;
  expiresAt: number;
}

/**
 * OAuth2 client_credentials, como Celcoin e a maioria dos BaaS.
 *
 * Existe para o adapter exercitar o fluxo de token de verdade, incluindo
 * expiracao e renovacao. Um Mock Bank sem autenticacao deixaria o cache de
 * token e o single-flight do kit sem cobertura.
 */
@Injectable()
export class TokenService {
  private readonly tokens = new Map<string, IssuedToken>();

  constructor(
    private readonly config: MockBankConfig,
    private readonly clock: MockClock,
  ) {}

  issue(clientId: string, clientSecret: string): { accessToken: string; expiresIn: number } {
    if (clientId !== this.config.clientId || clientSecret !== this.config.clientSecret) {
      throw MockBankError.unauthorized();
    }
    const accessToken = randomBytes(24).toString('hex');
    this.tokens.set(this.fingerprint(accessToken), {
      clientId,
      expiresAt: this.clock.now().getTime() + this.config.tokenTtlSeconds * 1000,
    });
    return { accessToken, expiresIn: this.config.tokenTtlSeconds };
  }

  verify(accessToken: string): string {
    const issued = this.tokens.get(this.fingerprint(accessToken));
    if (!issued) throw MockBankError.unauthorized();
    if (issued.expiresAt <= this.clock.now().getTime()) {
      this.tokens.delete(this.fingerprint(accessToken));
      throw MockBankError.unauthorized();
    }
    return issued.clientId;
  }

  revokeAll(): void {
    this.tokens.clear();
  }

  /** O token so existe em memoria como hash, como num provedor de verdade. */
  private fingerprint(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}

@Injectable()
export class BearerAuthGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { clientId?: string }>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw MockBankError.unauthorized();
    request.clientId = this.tokens.verify(header.slice('Bearer '.length));
    return true;
  }
}
