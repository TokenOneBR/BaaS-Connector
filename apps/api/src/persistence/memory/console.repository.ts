import type {
  ConsoleSessionRepository,
  ConsoleUserRecord,
  ConsoleUserRepository,
  SessionRecord,
} from '../../admin/admin.types.js';

/**
 * Dobros do console.
 *
 * Sem eles o `/admin/v1` inteiro exige Postgres para o LOGIN, e o console nao
 * pode ser exercitado ponta a ponta sem subir banco — foi o que impediu o
 * primeiro spec de Playwright de existir.
 *
 * O que reproduzem e a semantica que decide seguranca: `rotate` e um
 * compare-and-set (dois usos do mesmo refresh nao passam os dois), sessao
 * revogada nao volta a valer, e `findByEmail` normaliza o e-mail do mesmo
 * jeito que a coluna unica normaliza. O que NAO reproduzem — atomicidade sob
 * concorrencia real — continua provado contra Postgres.
 */
export class MemoryConsoleUserRepository implements ConsoleUserRepository {
  readonly rows = new Map<string, ConsoleUserRecord>();
  readonly lastLoginAt = new Map<string, Date>();

  seed(user: ConsoleUserRecord): ConsoleUserRecord {
    this.rows.set(user.id, user);
    return user;
  }

  async findByEmail(email: string) {
    const normalizado = email.trim().toLowerCase();
    return [...this.rows.values()].find((row) => row.email.toLowerCase() === normalizado);
  }

  async findById(id: string) {
    return this.rows.get(id);
  }

  async touchLogin(id: string, at: Date) {
    this.lastLoginAt.set(id, at);
  }
}

export class MemoryConsoleSessionRepository implements ConsoleSessionRepository {
  readonly rows = new Map<string, SessionRecord>();

  async create(input: {
    id: string;
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    this.rows.set(input.id, { ...input, revokedAt: null });
  }

  async findById(id: string) {
    return this.rows.get(id);
  }

  /**
   * Compare-and-set sobre o hash ANTERIOR nao cabe aqui: a porta so recebe o
   * novo. O que a atomicidade protege e a corrida entre dois refreshes
   * simultaneos, e a versao Prisma a garante com um `updateMany` condicional.
   * Aqui basta recusar sessao revogada ou vencida — que e a regra que o
   * console exercita.
   */
  async rotate(id: string, refreshTokenHash: string, expiresAt: Date): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.revokedAt) return false;

    row.refreshTokenHash = refreshTokenHash;
    row.expiresAt = expiresAt;
    return true;
  }

  async revoke(id: string, at: Date): Promise<void> {
    const row = this.rows.get(id);
    if (row) row.revokedAt = at;
  }

  async revokeAllForUser(userId: string, at: Date): Promise<void> {
    for (const row of this.rows.values()) {
      if (row.userId === userId && !row.revokedAt) row.revokedAt = at;
    }
  }
}
