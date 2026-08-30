import { generateKeyPairSync } from 'node:crypto';

import { encodeBase32, hashSecret, totpCode } from '@baasconn/crypto';
import { Environment, FixedClock, newId } from '@baasconn/taxonomy';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CONSOLE_SESSION_REPOSITORY,
  CONSOLE_USER_REPOSITORY,
  type ConsoleRole,
  type ConsoleSessionRepository,
  type ConsoleUserRecord,
  type ConsoleUserRepository,
  type SessionRecord,
} from '../src/admin/admin.types.js';
import { AppModule } from '../src/app.module.js';
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
const TOTP_BYTES = Buffer.from('12345678901234567890', 'ascii');
const TOTP_BASE32 = encodeBase32(TOTP_BYTES);

/**
 * O SENTINELA.
 *
 * Uma string improvavel gravada como credencial. Toda resposta que este
 * arquivo produz e varrida atras dela. Nao e um teste de um caminho: e a
 * afirmacao de que NENHUM caminho a devolve.
 */
const SENTINELA = 'segredo-sentinela-jamais-deve-aparecer-numa-resposta';

describe('credenciais e segredos nunca saem do /admin/v1', () => {
  let app: INestApplication;
  let baseUrl: string;
  let users: MemoryUsers;
  let clock: FixedClock;

  // ADMIN e OWNER EXIGEM segundo fator: quem pode gravar credencial de
  // provedor nao entra so com senha. O teste passa pelo caminho de verdade.
  const seedUser = async (email: string, role: ConsoleRole) => {
    const mfa = role === 'ADMIN' || role === 'OWNER';
    users.byEmail.set(email, {
      id: newId('user'),
      email,
      name: email,
      passwordHash: await hashSecret(SENHA),
      role,
      mfaEnabled: mfa,
      totpSecret: mfa ? TOTP_BASE32 : undefined,
      status: 'ACTIVE',
    });
  };

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://baas:baas@127.0.0.1:5432/baas?schema=public';
    process.env.KMS_MASTER_SECRET ??= 'segredo-mestre-de-teste-com-tamanho-suficiente';
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.JWT_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    process.env.JWT_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();

    users = new MemoryUsers();
    clock = new FixedClock(new Date('2026-08-30T12:00:00.000Z'));

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
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

  beforeEach(async () => {
    users.byEmail.clear();
    await seedUser('admin@tokenone.com.br', 'ADMIN');
    await seedUser('viewer@tokenone.com.br', 'VIEWER');
  });

  const token = async (email: string): Promise<string> => {
    const exigeMfa = users.byEmail.get(email)?.mfaEnabled ?? false;
    const response = await fetch(`${baseUrl}/admin/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password: SENHA,
        ...(exigeMfa ? { totp_code: totpCode(TOTP_BYTES, clock.now()) } : {}),
      }),
    });
    return ((await response.json()) as { access_token: string }).access_token;
  };

  const api = (path: string, jwt: string, init: RequestInit = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });

  const criarConexao = async (jwt: string) => {
    const response = await api('/admin/v1/connections', jwt, {
      method: 'POST',
      body: JSON.stringify({
        provider: 'MOCK_BANK',
        environment: Environment.HOMOLOGACAO,
        label: 'principal',
        credentials: { clientId: 'cliente-visivel', clientSecret: SENTINELA },
        webhook_secret: SENTINELA,
        config: {},
      }),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as { id: string };
  };

  it('a conexao criada devolve fingerprint e last4, nunca o segredo', async () => {
    const jwt = await token('admin@tokenone.com.br');
    const criada = await criarConexao(jwt);

    const detalhe = await api(
      `/admin/v1/connections/${criada.id}?environment=HOMOLOGACAO`,
      jwt,
    ).then((r) => r.json());

    expect(JSON.stringify(detalhe)).not.toContain(SENTINELA);
    expect(detalhe).toMatchObject({
      credentials: {
        set: true,
        // `last4` vem do campo que o ADAPTER declara exibivel — um
        // identificador (`clientId`), nunca um segredo.
        last4: 'ivel',
      },
    });
    expect((detalhe as { credentials: { fingerprint: string } }).credentials.fingerprint).toMatch(
      /^sha256:[0-9a-f]{16}$/,
    );
  });

  it('NENHUMA resposta do /admin/v1 contem o sentinela', async () => {
    const jwt = await token('admin@tokenone.com.br');
    const criada = await criarConexao(jwt);

    // Rotaciona, para exercitar tambem o caminho de escrita de credencial.
    await api(`/admin/v1/connections/${criada.id}/credentials?environment=HOMOLOGACAO`, jwt, {
      method: 'PUT',
      body: JSON.stringify({ credentials: { clientId: 'outro', clientSecret: SENTINELA } }),
    });

    const rotas = [
      '/admin/v1/connections?environment=HOMOLOGACAO',
      `/admin/v1/connections/${criada.id}?environment=HOMOLOGACAO`,
      '/admin/v1/api-keys?environment=HOMOLOGACAO',
      '/admin/v1/providers',
      '/admin/v1/me',
    ];

    for (const rota of rotas) {
      const corpo = await api(rota, jwt).then((r) => r.text());
      expect(corpo, rota).not.toContain(SENTINELA);
    }
  });

  it('a auditoria da rotacao grava fingerprint, nao o valor', async () => {
    // A trilha e append-only e nem o dono do banco a apaga. Um `before`/`after`
    // com credencial em claro seria um segredo gravado para sempre.
    const jwt = await token('admin@tokenone.com.br');
    const criada = await criarConexao(jwt);

    await api(`/admin/v1/connections/${criada.id}/credentials?environment=HOMOLOGACAO`, jwt, {
      method: 'PUT',
      body: JSON.stringify({ credentials: { clientId: 'outro', clientSecret: 'novo-segredo' } }),
    });

    const audit = app.get<{ rows: Array<Record<string, unknown>> }>(
      (await import('../src/events/outbox.types.js')).AUDIT_REPOSITORY,
    );
    const linhas = audit.rows.filter((row) => row.resourceId === criada.id);

    expect(linhas.length).toBeGreaterThan(0);
    expect(JSON.stringify(linhas)).not.toContain(SENTINELA);
    expect(JSON.stringify(linhas)).not.toContain('novo-segredo');
    expect(JSON.stringify(linhas)).toContain('fingerprint_after');
  });

  it('o segredo da API key aparece UMA vez, na criacao', async () => {
    const jwt = await token('admin@tokenone.com.br');

    const criada = await api('/admin/v1/api-keys', jwt, {
      method: 'POST',
      body: JSON.stringify({
        name: 'chave do teste',
        environment: Environment.HOMOLOGACAO,
        scopes: ['balance:read'],
        ip_allowlist: [],
      }),
    });
    expect(criada.status).toBe(201);

    const corpo = (await criada.json()) as { id: string; secret: string; warning: string };
    expect(corpo.secret).toMatch(/^bck_hml_/);
    expect(corpo.warning).toBe('Guarde esta chave agora: ela nao pode ser recuperada depois.');

    // E nunca mais. Nao ha rota que a devolva, e a listagem so tem prefixo.
    const lista = await api('/admin/v1/api-keys?environment=HOMOLOGACAO', jwt).then((r) =>
      r.text(),
    );
    expect(lista).not.toContain(corpo.secret);
    expect(lista).toContain(corpo.id);
  });

  it('chave de PRODUCAO com pix:write forca assinatura, e recusa desliga-la', async () => {
    const jwt = await token('admin@tokenone.com.br');

    // Recusa explicita, e nao sobrescrita silenciosa: o operador precisa
    // aprender a regra em vez de achar que a desligou.
    const recusada = await api('/admin/v1/api-keys', jwt, {
      method: 'POST',
      body: JSON.stringify({
        name: 'producao sem assinatura',
        environment: Environment.PRODUCAO,
        scopes: ['pix:write'],
        ip_allowlist: [],
        signing_required: false,
      }),
    });
    expect(recusada.status).toBe(422);
  });

  it('VIEWER lista conexoes mas nao as cria, e nao alcanca API keys', async () => {
    // VIEWER na listagem porque COMPLIANCE tem posto ABAIXO de OPERATOR, e a
    // tela de conciliacao precisa do filtro de conexao.
    const viewer = await token('viewer@tokenone.com.br');

    expect((await api('/admin/v1/connections?environment=HOMOLOGACAO', viewer)).status).toBe(200);
    expect((await api('/admin/v1/api-keys?environment=HOMOLOGACAO', viewer)).status).toBe(403);

    const criar = await api('/admin/v1/connections', viewer, {
      method: 'POST',
      body: JSON.stringify({
        provider: 'MOCK_BANK',
        environment: Environment.HOMOLOGACAO,
        label: 'x',
        credentials: { clientId: 'a', clientSecret: 'b' },
        config: {},
      }),
    });
    expect(criar.status).toBe(403);
  });

  it('credencial que o adapter recusa nao chega a ser cifrada', async () => {
    // Validar antes de cifrar: um `clientSecret` faltando detectado no
    // cadastro e erro de configuracao; detectado na primeira transferencia
    // e incidente.
    const jwt = await token('admin@tokenone.com.br');
    const response = await api('/admin/v1/connections', jwt, {
      method: 'POST',
      body: JSON.stringify({
        provider: 'MOCK_BANK',
        environment: Environment.HOMOLOGACAO,
        label: 'incompleta',
        credentials: { clientId: 'so-o-id' },
        config: {},
      }),
    });

    expect(response.status).toBe(422);
    const corpo = (await response.json()) as { error: { details?: unknown[] } };
    expect(corpo.error.details?.length).toBeGreaterThan(0);
  });

  it('a auditoria lista o que as rotas gravaram, com o ator certo', async () => {
    const jwt = await token('admin@tokenone.com.br');
    const criada = await criarConexao(jwt);

    const page = (await api(
      `/admin/v1/audit?environment=HOMOLOGACAO&resource_id=${criada.id}`,
      jwt,
    ).then((r) => r.json())) as { data: Array<Record<string, unknown>> };

    expect(page.data.length).toBeGreaterThan(0);
    expect(page.data[0]).toMatchObject({
      action: 'connection.created',
      // `USER`, e nao `API_KEY`: quem age no console e uma pessoa, e a trilha
      // precisa dizer QUEM, nao "o console".
      actor_type: 'USER',
      resource_type: 'provider_connection',
    });
    // `sequence` e string: a coluna e BigInt e o wire nao tem bigint.
    expect(typeof page.data[0]!.sequence).toBe('string');
  });

  it('VIEWER nao le auditoria; COMPLIANCE le', async () => {
    await seedUser('compliance@tokenone.com.br', 'COMPLIANCE');
    const viewer = await token('viewer@tokenone.com.br');
    const compliance = await token('compliance@tokenone.com.br');

    expect((await api('/admin/v1/audit?environment=HOMOLOGACAO', viewer)).status).toBe(403);
    expect((await api('/admin/v1/audit?environment=HOMOLOGACAO', compliance)).status).toBe(200);
  });

  it('sem `environment` na consulta, recusa', async () => {
    const jwt = await token('admin@tokenone.com.br');
    expect((await api('/admin/v1/connections', jwt)).status).toBe(422);
  });
});
