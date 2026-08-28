import { BaasError, BaasErrorCode, type Clock } from '@baasconn/taxonomy';
import { Inject, Injectable } from '@nestjs/common';
import jwt, { type Algorithm } from 'jsonwebtoken';

import { CLOCK } from '../common/clock.js';
import { ApiConfig } from '../config/config.service.js';

import type { AdminSession, ConsoleRole } from './admin.types.js';

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  email: string;
  role: ConsoleRole;
}

const ISSUER = 'baas-connector';
const AUDIENCE = 'baas-console';

/**
 * Emissao e verificacao do token de acesso do console.
 *
 * Assimetrico (RS256): a chave privada fica so na API, e qualquer servico que
 * precise validar o token — hoje nenhum, amanha o worker — recebe apenas a
 * publica. Com HMAC, validar exigiria distribuir a chave que tambem ASSINA.
 *
 * `algorithms` e fixado na verificacao. Sem isso, um token com
 * `"alg": "none"` — ou com HS256 usando a chave publica como segredo — passa:
 * e a familia de bugs de confusao de algoritmo, e a defesa e nunca deixar o
 * proprio token escolher como sera verificado.
 */
@Injectable()
export class AdminTokenService {
  private readonly algorithm: Algorithm = 'RS256';

  constructor(
    private readonly config: ApiConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  issueAccessToken(session: AdminSession): { token: string; expiresInSeconds: number } {
    const now = Math.floor(this.clock.now().getTime() / 1000);
    const expiresInSeconds = this.config.accessTokenTtlSeconds;

    const token = jwt.sign(
      {
        sub: session.userId,
        sid: session.sessionId,
        email: session.email,
        role: session.role,
        iat: now,
        exp: now + expiresInSeconds,
      },
      this.config.jwtPrivateKey,
      { algorithm: this.algorithm, issuer: ISSUER, audience: AUDIENCE },
    );

    return { token, expiresInSeconds };
  }

  verifyAccessToken(token: string): AdminSession {
    try {
      const claims = jwt.verify(token, this.config.jwtPublicKey || this.config.jwtPrivateKey, {
        algorithms: [this.algorithm],
        issuer: ISSUER,
        audience: AUDIENCE,
        clockTimestamp: Math.floor(this.clock.now().getTime() / 1000),
      }) as AccessTokenClaims;

      return {
        userId: claims.sub,
        sessionId: claims.sid,
        email: claims.email,
        role: claims.role,
      };
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new BaasError(BaasErrorCode.SESSION_EXPIRED, { cause: error });
      }
      throw new BaasError(BaasErrorCode.AUTHENTICATION_FAILED, {
        message: 'Token de sessao invalido.',
        cause: error,
      });
    }
  }
}
