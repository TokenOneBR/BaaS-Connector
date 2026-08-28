import type { Clock } from '@baasconn/taxonomy';

export type ConsoleRole = 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER' | 'COMPLIANCE';

/**
 * Papeis em ordem de privilegio.
 *
 * A ordem e usada por `atLeast()`: comparar posicao no array evita espalhar
 * listas de papeis por dezenas de decorators e esquecer de incluir OWNER na
 * de alguma rota nova — o modo de falha mais comum de RBAC feito a mao.
 */
export const ROLE_RANK: Readonly<Record<ConsoleRole, number>> = Object.freeze({
  VIEWER: 0,
  COMPLIANCE: 1,
  OPERATOR: 2,
  ADMIN: 3,
  OWNER: 4,
});

export function atLeast(role: ConsoleRole, minimum: ConsoleRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/** Papeis que exigem segundo fator. Quem pode gravar credencial precisa dele. */
export const MFA_REQUIRED_ROLES: ReadonlySet<ConsoleRole> = new Set<ConsoleRole>(['OWNER', 'ADMIN']);

export interface ConsoleUserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash?: string | null;
  role: ConsoleRole;
  mfaEnabled: boolean;
  totpSecret?: string;
  status: string;
}

export const CONSOLE_USER_REPOSITORY = Symbol('BAAS_CONSOLE_USER_REPOSITORY');

export interface ConsoleUserRepository {
  findByEmail(email: string): Promise<ConsoleUserRecord | undefined>;
  findById(id: string): Promise<ConsoleUserRecord | undefined>;
  touchLogin(id: string, at: Date): Promise<void>;
}

export interface SessionRecord {
  id: string;
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  revokedAt?: Date | null;
}

export const CONSOLE_SESSION_REPOSITORY = Symbol('BAAS_CONSOLE_SESSION_REPOSITORY');

export interface ConsoleSessionRepository {
  create(input: {
    id: string;
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<void>;
  findById(id: string): Promise<SessionRecord | undefined>;
  /** Rotaciona o refresh token; a operacao precisa ser atomica. */
  rotate(id: string, refreshTokenHash: string, expiresAt: Date): Promise<boolean>;
  revoke(id: string, at: Date): Promise<void>;
  revokeAllForUser(userId: string, at: Date): Promise<void>;
}

export interface AdminSession {
  userId: string;
  sessionId: string;
  email: string;
  role: ConsoleRole;
}

export interface AdminClock {
  clock: Clock;
}
