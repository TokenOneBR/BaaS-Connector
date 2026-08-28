import { generateKeyPairSync } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { encodeBase32, hashSecret, totpCode } from '@baasconn/crypto';
import { FixedClock, newId } from '@baasconn/taxonomy';
import express from 'express';

import {
  CONSOLE_SESSION_REPOSITORY,
  CONSOLE_USER_REPOSITORY,
  type ConsoleSessionRepository,
  type ConsoleUserRecord,
  type ConsoleUserRepository,
  type SessionRecord,
} from '../src/admin/admin.types.js';
import { AppModule } from '../src/app.module.js';
import { CLOCK } from '../src/common/clock.js';

class MemoryUsers implements ConsoleUserRepository {
  readonly byEmail = new Map<string, ConsoleUserRecord>();
  lastLoginAt?: Date;

  async findByEmail(email: string) {
    return this.byEmail.get(email);
  }
  async findById(id: string) {
    return [...this.byEmail.values()].find((user) => user.id === id);
  }
  async touchLogin(_id: string, at: Date) {
    this.lastLoginAt = at;
  }
}

class MemorySessions implements ConsoleSessionRepository {
  readonly rows = new Map<string, SessionRecord>();

  async create(input: {
    id: string;
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
  }) {
    this.rows.set(input.id, { ...input, revokedAt: null });
  }
  async findById(id: string) {
    return this.rows.get(id);
  }
  async rotate(id: string, refreshTokenHash: string, expiresAt: Date) {
    const row = this.rows.get(id);
    if (!row || row.revokedAt) return false;
    row.refreshTokenHash = refreshTokenHash;
    row.expiresAt = expiresAt;
    return true;
  }
  async revoke(id: string, at: Date) {
    const row = this.rows.get(id);
    if (row && !row.revokedAt) row.revokedAt = at;
  }
  async revokeAllForUser(userId: string, at: Date) {
    for (const row of this.rows.values()) {
      if (row.userId === userId && !row.revokedAt) row.revokedAt = at;
    }
  }
}

const TOTP_SECRET_BYTES = Buffer.from('12345678901234567890', 'ascii');
const TOTP_SECRET_BASE32 = encodeBase32(TOTP_SECRET_BYTES);

describe('sessao do console', () => {
  let app: INestApplication;
  let baseUrl: string;
  let users: MemoryUsers;
  let sessions: MemorySessions;
  let clock: FixedClock;

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://baas:baas@127.0.0.1:5432/baas?schema=public';

    // Par RSA gerado no teste: nada de chave commitada, e o teste prova que a
    // verificacao usa mesmo a publica correspondente.
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.JWT_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    process.env.JWT_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();

    users = new MemoryUsers();
    sessions = new MemorySessions();
    clock = new FixedClock(new Date('2026-08-28T12:00:00.000Z'));

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONSOLE_USER_REPOSITORY)
      .useValue(users)
      .overrideProvider(CONSOLE_SESSION_REPOSITORY)
      .useValue(sessions)
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

  beforeEach(async () => {
    clock.set(new Date('2026-08-28T12:00:00.000Z'));
    sessions.rows.clear();
    users.byEmail.clear();

    users.byEmail.set('operador@tokenone.com.br', {
      id: newId('user'),
      email: 'operador@tokenone.com.br',
      name: 'Operadora',
      passwordHash: await hashSecret('senha-de-teste-bem-longa'),
      role: 'OPERATOR',
      mfaEnabled: false,
      status: 'ACTIVE',
    });

    users.byEmail.set('dona@tokenone.com.br', {
      id: newId('user'),
      email: 'dona@tokenone.com.br',
      name: 'Dona',
      passwordHash: await hashSecret('senha-de-teste-bem-longa'),
      role: 'OWNER',
      mfaEnabled: true,
      totpSecret: TOTP_SECRET_BASE32,
      status: 'ACTIVE',
    });
  });

  const login = (body: Record<string, unknown>) =>
    fetch(`${baseUrl}/admin/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const get = (path: string, token?: string) =>
    fetch(`${baseUrl}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

  it('autentica e devolve um token de acesso utilizavel', async () => {
    const response = await login({
      email: 'operador@tokenone.com.br',
      password: 'senha-de-teste-bem-longa',
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { access_token: string; user: { role: string } };
    expect(body.user.role).toBe('OPERATOR');

    const me = await get('/admin/v1/me', body.access_token);
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ email: 'operador@tokenone.com.br', role: 'OPERATOR' });
  });

  it('nao revela se o e-mail existe', async () => {
    const inexistente = await login({ email: 'ninguem@tokenone.com.br', password: 'seja-o-que-for' });
    const senhaErrada = await login({
      email: 'operador@tokenone.com.br',
      password: 'senha-errada-mas-longa',
    });

    expect(inexistente.status).toBe(senhaErrada.status);
    expect(inexistente.status).toBe(401);

    const corpoInexistente = (await inexistente.json()) as { error: Record<string, unknown> };
    const corpoSenhaErrada = (await senhaErrada.json()) as { error: Record<string, unknown> };

    // Mesmo codigo E mesma mensagem: o corpo da resposta nao pode ser um
    // oraculo de enumeracao de contas.
    expect(corpoInexistente.error.code).toBe('AUTHENTICATION_FAILED');
    expect(corpoInexistente.error.message).toBe(corpoSenhaErrada.error.message);
  });

  it('exige segundo fator de quem pode gravar credencial', async () => {
    const semCodigo = await login({
      email: 'dona@tokenone.com.br',
      password: 'senha-de-teste-bem-longa',
    });
    expect(semCodigo.status).toBe(401);
    // Codigo proprio: a acao do cliente e pedir o TOTP, nao a senha de novo.
    expect((await semCodigo.json()) as { error: { code: string } }).toMatchObject({
      error: { code: 'MFA_REQUIRED' },
    });

    const comCodigo = await login({
      email: 'dona@tokenone.com.br',
      password: 'senha-de-teste-bem-longa',
      totp_code: totpCode(TOTP_SECRET_BYTES, clock.now()),
    });
    expect(comCodigo.status).toBe(200);
  });

  it('recusa TOTP de outro instante', async () => {
    const codigoAntigo = totpCode(TOTP_SECRET_BYTES, new Date(clock.now().getTime() - 600_000));
    const response = await login({
      email: 'dona@tokenone.com.br',
      password: 'senha-de-teste-bem-longa',
      totp_code: codigoAntigo,
    });
    expect(response.status).toBe(401);
  });

  it('aplica papel minimo por rota', async () => {
    const operador = await accessTokenFor('operador@tokenone.com.br');

    // OPERATOR alcanca a matriz de capacidades...
    expect((await get('/admin/v1/providers', operador)).status).toBe(200);

    // ...mas nao a configuracao de runtime, que revela a postura de seguranca
    // do deploy.
    const negado = await get('/admin/v1/config', operador);
    expect(negado.status).toBe(403);
    expect((await negado.json()) as { error: { code: string } }).toMatchObject({
      error: { code: 'AUTHORIZATION_DENIED' },
    });

    const dona = await accessTokenFor(
      'dona@tokenone.com.br',
      totpCode(TOTP_SECRET_BYTES, clock.now()),
    );
    expect((await get('/admin/v1/config', dona)).status).toBe(200);
  });

  it('encerra a sessao no logout, antes de o token expirar', async () => {
    const body = (await (
      await login({ email: 'operador@tokenone.com.br', password: 'senha-de-teste-bem-longa' })
    ).json()) as { access_token: string };

    expect((await get('/admin/v1/me', body.access_token)).status).toBe(200);

    const logout = await fetch(`${baseUrl}/admin/v1/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${body.access_token}` },
    });
    expect(logout.status).toBe(204);

    // O JWT ainda esta dentro da validade; e a checagem de sessao viva que faz
    // "desconectar" significar agora, e nao daqui a quinze minutos.
    const depois = await get('/admin/v1/me', body.access_token);
    expect(depois.status).toBe(401);
    expect((await depois.json()) as { error: { code: string } }).toMatchObject({
      error: { code: 'SESSION_EXPIRED' },
    });
  });

  it('rotaciona o refresh token e trata reuso como roubo', async () => {
    const first = (await (
      await login({ email: 'operador@tokenone.com.br', password: 'senha-de-teste-bem-longa' })
    ).json()) as { refresh_token: string };

    const refreshed = await fetch(`${baseUrl}/admin/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: first.refresh_token }),
    });
    expect(refreshed.status).toBe(200);
    const second = (await refreshed.json()) as { refresh_token: string; access_token: string };
    expect(second.refresh_token).not.toBe(first.refresh_token);

    // Reapresentar o token antigo indica que ele vazou: derruba TODAS as
    // sessoes do usuario, nao so esta.
    const reuse = await fetch(`${baseUrl}/admin/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: first.refresh_token }),
    });
    expect(reuse.status).toBe(401);

    expect((await get('/admin/v1/me', second.access_token)).status).toBe(401);
  });

  it('recusa token expirado com SESSION_EXPIRED', async () => {
    const token = await accessTokenFor('operador@tokenone.com.br');
    clock.advanceSeconds(3_600);

    const response = await get('/admin/v1/me', token);
    expect(response.status).toBe(401);
    expect((await response.json()) as { error: { code: string } }).toMatchObject({
      error: { code: 'SESSION_EXPIRED' },
    });
  });

  it('recusa token assinado com outra chave', async () => {
    const token = await accessTokenFor('operador@tokenone.com.br');
    // Troca o payload mantendo a assinatura: e o ataque que a verificacao com
    // algoritmo fixo precisa barrar.
    const [header, , signature] = token.split('.');
    const forged = `${header}.${Buffer.from(
      JSON.stringify({ sub: 'usr_falso', sid: 'ses_falso', role: 'OWNER' }),
    ).toString('base64url')}.${signature}`;

    expect((await get('/admin/v1/me', forged)).status).toBe(401);
  });

  async function accessTokenFor(email: string, totp?: string): Promise<string> {
    const body = (await (
      await login({ email, password: 'senha-de-teste-bem-longa', totp_code: totp })
    ).json()) as { access_token: string };
    return body.access_token;
  }
});
