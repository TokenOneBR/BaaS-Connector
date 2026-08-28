import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { decodeBase32, hashSecret, verifySecret, verifyTotp } from '@baasconn/crypto';
import { Metrics } from '@baasconn/observability';
import { BaasError, BaasErrorCode, newId, type Clock } from '@baasconn/taxonomy';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { CLOCK } from '../common/clock.js';
import { ApiConfig } from '../config/config.service.js';

import {
  CONSOLE_SESSION_REPOSITORY,
  CONSOLE_USER_REPOSITORY,
  MFA_REQUIRED_ROLES,
  type AdminSession,
  type ConsoleSessionRepository,
  type ConsoleUserRecord,
  type ConsoleUserRepository,
} from './admin.types.js';
import { AdminTokenService } from './token.service.js';

export interface LoginInput {
  email: string;
  password: string;
  totpCode?: string;
  userAgent?: string;
  ipAddress?: string;
}

export interface IssuedSession {
  accessToken: string;
  expiresInSeconds: number;
  refreshToken: string;
  user: { id: string; email: string; name: string; role: string };
}

/**
 * Hash descartavel usado quando o e-mail nao existe.
 *
 * Verificar um hash real mesmo sem usuario mantem o tempo de resposta
 * indistinguivel entre "e-mail inexistente" e "senha errada". Sem isso, o
 * tempo de resposta vira um oraculo de enumeracao de contas.
 */
const DUMMY_HASH_PROMISE = hashSecret(randomBytes(32).toString('hex'));

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly config: ApiConfig,
    private readonly tokens: AdminTokenService,
    private readonly metrics: Metrics,
    @Inject(CONSOLE_USER_REPOSITORY) private readonly users: ConsoleUserRepository,
    @Inject(CONSOLE_SESSION_REPOSITORY) private readonly sessions: ConsoleSessionRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async login(input: LoginInput): Promise<IssuedSession> {
    const user = await this.users.findByEmail(input.email.trim().toLowerCase());

    // Roda sempre, com usuario ou sem: o custo constante e o ponto.
    const passwordOk = user?.passwordHash
      ? await verifySecret(user.passwordHash, input.password)
      : await verifySecret(await DUMMY_HASH_PROMISE, input.password);

    if (!user || !passwordOk) {
      this.metrics.apiKeyAuthFailures.inc({ reason: 'console_bad_credentials' });
      // Mensagem unica de proposito: dizer "e-mail nao cadastrado" entrega ao
      // atacante metade do trabalho.
      throw new BaasError(BaasErrorCode.AUTHENTICATION_FAILED, {
        message: 'E-mail ou senha invalidos.',
      });
    }

    if (user.status !== 'ACTIVE') {
      throw new BaasError(BaasErrorCode.AUTHORIZATION_DENIED, {
        message: 'Este usuario esta desativado.',
      });
    }

    this.assertSecondFactor(user, input.totpCode);

    const issued = await this.issue(user, input);
    await this.users.touchLogin(user.id, this.clock.now());
    this.logger.log({ user_id: user.id, role: user.role }, 'Sessao de console criada');

    return issued;
  }

  /**
   * Renova a sessao rotacionando o refresh token.
   *
   * A rotacao e condicional (`rotate` so tem efeito se o hash ainda for o
   * corrente), entao um refresh token roubado e usado depois do legitimo falha
   * — e a falha e o sinal de que houve roubo.
   */
  async refresh(rawToken: string, context: { userAgent?: string; ipAddress?: string } = {}): Promise<IssuedSession> {
    const parsed = parseRefreshToken(rawToken);
    if (!parsed) throw new BaasError(BaasErrorCode.SESSION_EXPIRED);

    const session = await this.sessions.findById(parsed.sessionId);
    const now = this.clock.now();
    if (!session || session.revokedAt || session.expiresAt <= now) {
      throw new BaasError(BaasErrorCode.SESSION_EXPIRED);
    }

    const presented = hashRefreshToken(parsed.secret);
    if (!constantTimeStringEqual(presented, session.refreshTokenHash)) {
      // Token antigo apresentado depois de uma rotacao: trata-se como roubo e
      // derruba TODAS as sessoes do usuario, nao so esta.
      await this.sessions.revokeAllForUser(session.userId, now);
      this.metrics.apiKeyAuthFailures.inc({ reason: 'console_refresh_reuse' });
      this.logger.warn({ user_id: session.userId }, 'Refresh token reutilizado; sessoes revogadas');
      throw new BaasError(BaasErrorCode.SESSION_EXPIRED, {
        message: 'Sessao encerrada por seguranca. Entre novamente.',
      });
    }

    const user = await this.users.findById(session.userId);
    if (!user || user.status !== 'ACTIVE') throw new BaasError(BaasErrorCode.SESSION_EXPIRED);

    const secret = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + this.config.refreshTokenTtlSeconds * 1000);
    const rotated = await this.sessions.rotate(session.id, hashRefreshToken(secret), expiresAt);
    if (!rotated) throw new BaasError(BaasErrorCode.SESSION_EXPIRED);

    void context;
    const claims: AdminSession = {
      userId: user.id,
      sessionId: session.id,
      email: user.email,
      role: user.role,
    };
    const access = this.tokens.issueAccessToken(claims);

    return {
      accessToken: access.token,
      expiresInSeconds: access.expiresInSeconds,
      refreshToken: formatRefreshToken(session.id, secret),
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId, this.clock.now());
  }

  /**
   * Confirma que a sessao do token ainda existe.
   *
   * O JWT sozinho nao basta: revogar uma sessao precisa ter efeito ANTES de o
   * access token expirar, senao "desconectar todos os dispositivos" e uma
   * promessa que so vale daqui a quinze minutos.
   */
  async assertSessionAlive(session: AdminSession): Promise<void> {
    const record = await this.sessions.findById(session.sessionId);
    const now = this.clock.now();
    if (!record || record.revokedAt || record.expiresAt <= now) {
      throw new BaasError(BaasErrorCode.SESSION_EXPIRED);
    }
  }

  private assertSecondFactor(user: ConsoleUserRecord, code?: string): void {
    const required = user.mfaEnabled || MFA_REQUIRED_ROLES.has(user.role);
    if (!required) return;

    if (!user.totpSecret) {
      // OWNER/ADMIN sem TOTP configurado nao entra: seria a conta com mais
      // poder do sistema protegida so por senha.
      throw new BaasError(BaasErrorCode.AUTHORIZATION_DENIED, {
        message:
          'Este papel exige verificacao em duas etapas, que ainda nao foi configurada. ' +
          'Peca a um administrador para concluir a configuracao.',
      });
    }

    if (!code) throw new BaasError(BaasErrorCode.MFA_REQUIRED);

    if (!verifyTotp(decodeBase32(user.totpSecret), code, this.clock.now())) {
      this.metrics.apiKeyAuthFailures.inc({ reason: 'console_bad_totp' });
      throw new BaasError(BaasErrorCode.MFA_REQUIRED, {
        message: 'O codigo de verificacao nao confere.',
      });
    }
  }

  private async issue(user: ConsoleUserRecord, input: LoginInput): Promise<IssuedSession> {
    const sessionId = newId('user');
    const secret = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      this.clock.now().getTime() + this.config.refreshTokenTtlSeconds * 1000,
    );

    await this.sessions.create({
      id: sessionId,
      userId: user.id,
      refreshTokenHash: hashRefreshToken(secret),
      expiresAt,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
    });

    const access = this.tokens.issueAccessToken({
      userId: user.id,
      sessionId,
      email: user.email,
      role: user.role,
    });

    return {
      accessToken: access.token,
      expiresInSeconds: access.expiresInSeconds,
      refreshToken: formatRefreshToken(sessionId, secret),
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    };
  }
}

/**
 * Refresh token: `<sessionId>.<segredo>`.
 *
 * O identificador viaja junto para a validacao ser UMA leitura indexada. Sem
 * ele, verificar exigiria varrer as sessoes vivas comparando hashes.
 */
export function formatRefreshToken(sessionId: string, secret: string): string {
  return `${sessionId}.${secret}`;
}

export function parseRefreshToken(value: string): { sessionId: string; secret: string } | undefined {
  const separator = value.indexOf('.');
  if (separator <= 0 || separator === value.length - 1) return undefined;
  return { sessionId: value.slice(0, separator), secret: value.slice(separator + 1) };
}

/**
 * sha256, e nao Argon2id.
 *
 * O segredo tem 256 bits de entropia aleatoria: nao ha dicionario para atacar,
 * e um KDF caro aqui so tornaria o refresh — que roda a cada quinze minutos em
 * toda aba aberta — desnecessariamente lento.
 */
export function hashRefreshToken(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function constantTimeStringEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
