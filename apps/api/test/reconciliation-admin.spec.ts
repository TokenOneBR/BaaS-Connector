import { generateKeyPairSync } from 'node:crypto';

import { encodeBase32, hashSecret, totpCode } from '@baasconn/crypto';
import {
  BreakSeverity,
  BreakStatus,
  BreakType,
  Environment,
  FixedClock,
  newId,
} from '@baasconn/taxonomy';
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
import type { MemoryReconciliationBreakRepository } from '../src/persistence/memory/reconciliation.repositories.js';
import { RECONCILIATION_BREAK_REPOSITORY } from '../src/reconciliation/reconciliation.types.js';

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

const TOTP_SECRET_BYTES = Buffer.from('12345678901234567890', 'ascii');
const TOTP_SECRET_BASE32 = encodeBase32(TOTP_SECRET_BYTES);
const SENHA = 'senha-de-teste-bem-longa';
const NOTA = 'Divergencia conferida com o provedor por telefone.';
const CONEXAO = 'con_1';

/**
 * RBAC das rotas de conciliacao.
 *
 * Fechar uma divergencia de dinheiro e a mesma classe de acao que cunhar API
 * key: uma das oito acoes CREDITA a conta de um cliente. Ler e outra coisa —
 * e `COMPLIANCE`, que tem posto ABAIXO de `OPERATOR`, existe justamente para
 * olhar divergencia.
 */
describe('rotas admin de conciliacao', () => {
  let app: INestApplication;
  let baseUrl: string;
  let users: MemoryUsers;
  let breaks: MemoryReconciliationBreakRepository;
  let clock: FixedClock;
  let accountId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://baas:baas@127.0.0.1:5432/baas?schema=public';

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

    breaks = app.get(RECONCILIATION_BREAK_REPOSITORY);
  });

  afterAll(async () => {
    await app?.close();
  });

  const seedUser = async (email: string, role: ConsoleRole, mfa: boolean) => {
    users.byEmail.set(email, {
      id: newId('user'),
      email,
      name: email,
      passwordHash: await hashSecret(SENHA),
      role,
      mfaEnabled: mfa,
      totpSecret: mfa ? TOTP_SECRET_BASE32 : undefined,
      status: 'ACTIVE',
    });
  };

  beforeEach(async () => {
    clock.set(new Date('2026-08-30T12:00:00.000Z'));
    users.byEmail.clear();
    breaks.rows.clear();

    await seedUser('viewer@tokenone.com.br', 'VIEWER', false);
    await seedUser('compliance@tokenone.com.br', 'COMPLIANCE', false);
    await seedUser('operador@tokenone.com.br', 'OPERATOR', false);
    await seedUser('admin@tokenone.com.br', 'ADMIN', true);

    accountId = newId('account');
  });

  const abrirQuebra = async (): Promise<string> => {
    const id = newId('reconciliationBreak');
    await breaks.upsertMany(
      [
        {
          id,
          environment: Environment.HOMOLOGACAO,
          runId: newId('reconciliationRun'),
          connectionId: CONEXAO,
          accountId,
          type: BreakType.MISSING_ON_PROVIDER,
          severity: BreakSeverity.CRITICAL,
          dedupeKey: `e2e:${id}`,
          effectiveDate: '2026-08-29',
          amountCents: 50_000n,
          description: 'Debito registrado que o provedor nunca teve.',
          evidence: {},
        },
      ],
      clock.now(),
    );
    return id;
  };

  const token = async (email: string, mfa = false): Promise<string> => {
    const response = await fetch(`${baseUrl}/admin/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password: SENHA,
        ...(mfa ? { totp_code: totpCode(TOTP_SECRET_BYTES, clock.now()) } : {}),
      }),
    });
    const body = (await response.json()) as { access_token: string };
    return body.access_token;
  };

  const get = (path: string, jwt: string) =>
    fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${jwt}` } });

  const resolve = (id: string, jwt: string, body: Record<string, unknown>) =>
    fetch(`${baseUrl}/admin/v1/reconciliation/breaks/${id}/resolve?environment=HOMOLOGACAO`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('COMPLIANCE le a lista de quebras', async () => {
    await abrirQuebra();
    const response = await get(
      '/admin/v1/reconciliation/breaks?environment=HOMOLOGACAO',
      await token('compliance@tokenone.com.br'),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      type: BreakType.MISSING_ON_PROVIDER,
      severity: BreakSeverity.CRITICAL,
      status: BreakStatus.OPEN,
      amount: { amount: '50000', currency: 'BRL', scale: 2 },
    });
  });

  it('VIEWER nao le quebra', async () => {
    await abrirQuebra();
    const response = await get(
      '/admin/v1/reconciliation/breaks?environment=HOMOLOGACAO',
      await token('viewer@tokenone.com.br'),
    );
    expect(response.status).toBe(403);
  });

  it('sem sessao, nao le quebra', async () => {
    const response = await fetch(
      `${baseUrl}/admin/v1/reconciliation/breaks?environment=HOMOLOGACAO`,
    );
    // `@Public()` desliga o guard de API KEY, nao a autenticacao: a rota de
    // console continua exigindo sessao.
    expect(response.status).toBe(401);
  });

  /**
   * A mutacao que este teste existe para matar: baixar o minimo para
   * `OPERATOR` faria um clique creditar conta de cliente sem papel de
   * administrador.
   */
  it('OPERATOR nao resolve quebra', async () => {
    const id = await abrirQuebra();
    const response = await resolve(id, await token('operador@tokenone.com.br'), {
      action: 'WRITE_OFF',
      note: NOTA,
    });

    expect(response.status).toBe(403);
    expect((await breaks.findById(Environment.HOMOLOGACAO, id))?.status).toBe(BreakStatus.OPEN);
  });

  it('COMPLIANCE le mas nao resolve', async () => {
    const id = await abrirQuebra();
    const jwt = await token('compliance@tokenone.com.br');

    expect(
      (await get(`/admin/v1/reconciliation/breaks/${id}?environment=HOMOLOGACAO`, jwt)).status,
    ).toBe(200);
    expect((await resolve(id, jwt, { action: 'WRITE_OFF', note: NOTA })).status).toBe(403);
  });

  it('ADMIN resolve', async () => {
    const id = await abrirQuebra();
    const response = await resolve(id, await token('admin@tokenone.com.br', true), {
      action: 'WRITE_OFF',
      note: NOTA,
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      status: BreakStatus.WRITTEN_OFF,
      resolution: 'WRITE_OFF',
    });
  });

  it('justificativa curta e recusada', async () => {
    const id = await abrirQuebra();
    // `zResolveBreak` exige `min(10)`: "ok" nao e trilha de auditoria.
    const response = await resolve(id, await token('admin@tokenone.com.br', true), {
      action: 'WRITE_OFF',
      note: 'ok',
    });

    expect(response.status).toBe(422);
    expect((await breaks.findById(Environment.HOMOLOGACAO, id))?.status).toBe(BreakStatus.OPEN);
  });

  it('sem ambiente na consulta, recusa', async () => {
    // A sessao de console nao carrega ambiente. Adivinha-lo deixaria uma
    // sessao de homologacao resolver, sem perceber, uma quebra de producao.
    const response = await get(
      '/admin/v1/reconciliation/breaks',
      await token('compliance@tokenone.com.br'),
    );
    expect(response.status).toBe(422);
  });

  it('a evidencia dos dois lados sai em rota separada', async () => {
    // Blob JSON gordo, e a listagem e o caminho quente: carrega-lo em toda
    // linha da tabela seria pagar a evidencia de cinquenta quebras para
    // mostrar uma.
    const id = await abrirQuebra();
    const response = await get(
      `/admin/v1/reconciliation/breaks/${id}/evidence?environment=HOMOLOGACAO`,
      await token('compliance@tokenone.com.br'),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ break_id: id, evidence: {} });
  });

  it('as execucoes listam com contadores e o delta de saldo', async () => {
    // Os seis numeros eram gravados por `complete()` e ILEGIVEIS: o record nao
    // os carregava e nao havia listagem. O contrato descreve `balance_delta`
    // como "numero de manchete do dashboard", e ele nao saia do banco.
    const runs = app.get<{
      startRun: (input: Record<string, unknown>) => Promise<{ run: { id: string } }>;
      complete: (input: Record<string, unknown>) => Promise<void>;
    }>(
      (await import('../src/reconciliation/reconciliation.types.js')).RECONCILIATION_RUN_REPOSITORY,
    );

    const { run } = await runs.startRun({
      id: newId('reconciliationRun'),
      environment: Environment.HOMOLOGACAO,
      connectionId: CONEXAO,
      accountId,
      scope: 'DAILY',
      windowStart: new Date('2026-08-29T03:00:00.000Z'),
      windowEnd: new Date('2026-08-30T03:00:00.000Z'),
      triggeredBy: 'teste',
    });
    await runs.complete({
      id: run.id,
      status: 'COMPLETED_WITH_BREAKS',
      counters: {
        providerItemCount: 10,
        localItemCount: 9,
        ledgerItemCount: 9,
        matchedCount: 9,
        breakCount: 1,
      },
      balances: { balanceDeltaCents: -25_000n },
      finishedAt: new Date('2026-08-30T03:05:00.000Z'),
    });

    const body = (await get(
      '/admin/v1/reconciliation/runs?environment=HOMOLOGACAO',
      await token('compliance@tokenone.com.br'),
    ).then((r) => r.json())) as { data: Array<Record<string, unknown>> };

    expect(body.data[0]).toMatchObject({
      provider_item_count: 10,
      break_count: 1,
      balance_delta: { amount: '-25000', currency: 'BRL', scale: 2 },
    });
  });

  it('quebra de outro ambiente devolve 404', async () => {
    const id = await abrirQuebra();
    const response = await get(
      `/admin/v1/reconciliation/breaks/${id}?environment=PRODUCAO`,
      await token('compliance@tokenone.com.br'),
    );
    expect([404, 422]).toContain(response.status);
  });
});
