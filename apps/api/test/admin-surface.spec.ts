import { generateKeyPairSync } from 'node:crypto';

import { hashSecret } from '@baasconn/crypto';
import { FixedClock, newId } from '@baasconn/taxonomy';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ROTAS_ANONIMAS } from '../src/admin/admin-surface.guard.js';
import {
  CONSOLE_SESSION_REPOSITORY,
  CONSOLE_USER_REPOSITORY,
  type ConsoleSessionRepository,
  type ConsoleUserRecord,
  type ConsoleUserRepository,
  type SessionRecord,
} from '../src/admin/admin.types.js';
import { AppModule } from '../src/app.module.js';
import { Public } from '../src/auth/api-key.guard.js';
import { CLOCK } from '../src/common/clock.js';

class MemoryUsers implements ConsoleUserRepository {
  readonly byEmail = new Map<string, ConsoleUserRecord>();
  async findByEmail(email: string) {
    return this.byEmail.get(email);
  }
  async findById(id: string) {
    return [...this.byEmail.values()].find((user) => user.id === id);
  }
  async touchLogin() {}
}

class MemorySessions implements ConsoleSessionRepository {
  readonly rows = new Map<string, SessionRecord>();
  async create(input: { id: string; userId: string; refreshTokenHash: string; expiresAt: Date }) {
    this.rows.set(input.id, { ...input, revokedAt: null });
  }
  async findById(id: string) {
    return this.rows.get(id);
  }
  async rotate() {
    return true;
  }
  async revoke() {}
  async revokeAllForUser() {}
}

const SENHA = 'senha-de-teste-bem-longa';

/**
 * Controller escrito na forma ANTIGA e fail-open, de proposito.
 *
 * `@Public()` desliga o guard de API key; a ausencia de
 * `@UseGuards(AdminSessionGuard)` e o esquecimento que a guarda de superficie
 * existe para tornar inofensivo.
 */
@Controller('admin/v1/esquecido')
@Public()
class EsquecidoController {
  @Get()
  alcancar(): { alcancado: boolean } {
    return { alcancado: true };
  }
}

/**
 * A superficie `/admin/v1` e fail-CLOSED.
 *
 * O padrao anterior — `@Public()` na classe mais `@UseGuards` lembrado em cada
 * metodo — deixa uma rota nova anonima quando alguem esquece o decorator. Numa
 * superficie que grava credencial de provedor e cunha API key, com onze
 * controllers a mais chegando, a pergunta deixa de ser SE alguem vai esquecer.
 */
describe('superficie do /admin/v1', () => {
  let app: INestApplication;
  let baseUrl: string;
  let users: MemoryUsers;
  let clock: FixedClock;

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://baas:baas@127.0.0.1:5432/baas?schema=public';
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.JWT_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    process.env.JWT_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();

    users = new MemoryUsers();
    clock = new FixedClock(new Date('2026-08-30T12:00:00.000Z'));

    users.byEmail.set('viewer@tokenone.com.br', {
      id: newId('user'),
      email: 'viewer@tokenone.com.br',
      name: 'Viewer',
      passwordHash: await hashSecret(SENHA),
      role: 'VIEWER',
      mfaEnabled: false,
      status: 'ACTIVE',
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [EsquecidoController],
    })
      .overrideProvider(CONSOLE_USER_REPOSITORY)
      .useValue(users)
      .overrideProvider(CONSOLE_SESSION_REPOSITORY)
      .useValue(new MemorySessions())
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();

    app = moduleRef.createNestApplication({ bodyParser: false });
    app.use(express.json());
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
  });

  const get = (path: string, headers: Record<string, string> = {}) =>
    fetch(`${baseUrl}${path}`, { headers });

  const login = async (): Promise<string> => {
    const response = await fetch(`${baseUrl}/admin/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'viewer@tokenone.com.br', password: SENHA }),
    });
    return ((await response.json()) as { access_token: string }).access_token;
  };

  it('rota admin sem sessao e 401, nao 200', async () => {
    for (const path of ['/admin/v1/me', '/admin/v1/providers', '/admin/v1/config']) {
      expect((await get(path)).status, path).toBe(401);
    }
  });

  /**
   * A prova central deste arquivo.
   *
   * `EsquecidoController` esta escrito exatamente na forma antiga e
   * fail-open: `@Public()` na classe — que desliga o `ApiKeyGuard` — e
   * NENHUM `@UseGuards(AdminSessionGuard)`, que e o decorator que alguem
   * esquece. Antes da guarda de superficie isto respondia 200 para qualquer
   * um na internet.
   */
  it('controller admin sem nenhum decorator de sessao e 401', async () => {
    expect((await get('/admin/v1/esquecido')).status).toBe(401);
  });

  it('e o mesmo controller responde com sessao valida', async () => {
    // Sem esta metade, o teste acima passaria com a rota simplesmente quebrada.
    const token = await login();
    const response = await get('/admin/v1/esquecido', { Authorization: `Bearer ${token}` });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ alcancado: true });
  });

  it('so login e refresh sao anonimos, e a lista e fechada', async () => {
    // Casado por metodo E caminho exatos. Um prefixo (`/admin/v1/auth`) abriria
    // toda rota futura sob ele — e `logout` mora ali e precisa de sessao.
    expect(ROTAS_ANONIMAS).toEqual(['POST /admin/v1/auth/login', 'POST /admin/v1/auth/refresh']);
    expect((await fetch(`${baseUrl}/admin/v1/auth/logout`, { method: 'POST' })).status).toBe(401);
  });

  it('cookie `baas_session` NAO autentica mais', async () => {
    // O ramo era codigo morto — nada no repositorio escrevia esse cookie —,
    // mas codigo morto que anuncia "aceitamos cookie aqui" numa superficie sem
    // CSRF e com CORS `credentials: true`. Com um Bearer valido a mesma rota
    // responde 200; ver `admin-auth.spec.ts`.
    const token = await login();

    expect((await get('/admin/v1/me', { Authorization: `Bearer ${token}` })).status).toBe(200);
    expect((await get('/admin/v1/me', { Cookie: `baas_session=${token}` })).status).toBe(401);
  });

  it('a rota de API key continua alcancavel sem sessao de console', async () => {
    // A guarda so age sob `/admin/v1`. Se ela vazasse para `/v1`, toda a API
    // publica passaria a exigir sessao de console.
    const response = await get('/v1/accounts');
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).not.toContain('Sessao de console');
  });

  it('healthz continua publico', async () => {
    expect((await get('/healthz')).status).toBe(200);
  });
});
