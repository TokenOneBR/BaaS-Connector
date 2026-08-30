import { generateKeyPairSync } from 'node:crypto';

import { hashSecret } from '@baasconn/crypto';
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
import {
  WEBHOOK_DELIVERY_REPOSITORY,
  WEBHOOK_ENDPOINT_REPOSITORY,
} from '../src/events/outbox-delivery.types.js';
import { MemoryInboundEventRepository } from '../src/persistence/memory/domain.repositories.js';
import {
  MemoryWebhookDeliveryRepository,
  MemoryWebhookEndpointRepository,
} from '../src/persistence/memory/outbox-delivery.repositories.js';
import { INBOUND_EVENT_REPOSITORY } from '../src/webhooks/webhooks.types.js';

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
 * O SENTINELA do segredo de assinatura de saida.
 *
 * A tela de webhooks e a que mais tenta o desenho errado: e natural querer
 * mostrar o segredo "para o cliente conferir". Este teste afirma que nenhuma
 * rota o serve — e a garantia real e a FORMA de `WebhookEndpointSummary`, que
 * nao tem o campo.
 */
const SENTINELA = 'segredo-de-assinatura-jamais-numa-resposta';

const envelope = (texto: string) => ({
  ciphertext: Buffer.from(texto, 'utf8'),
  iv: Buffer.alloc(12),
  authTag: Buffer.alloc(16),
  wrappedKey: Buffer.from(texto, 'utf8'),
  keyId: 'local/test',
  version: 1,
});

describe('/admin/v1/webhooks', () => {
  let app: INestApplication;
  let baseUrl: string;
  let users: MemoryUsers;
  let clock: FixedClock;
  const inbound = new MemoryInboundEventRepository();
  const endpoints = new MemoryWebhookEndpointRepository();
  const deliveries = new MemoryWebhookDeliveryRepository();

  const seedUser = async (email: string, role: ConsoleRole) => {
    users.byEmail.set(email, {
      id: newId('user'),
      email,
      name: email,
      passwordHash: await hashSecret(SENHA),
      role,
      mfaEnabled: false,
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
      .overrideProvider(INBOUND_EVENT_REPOSITORY)
      .useValue(inbound)
      .overrideProvider(WEBHOOK_ENDPOINT_REPOSITORY)
      .useValue(endpoints)
      .overrideProvider(WEBHOOK_DELIVERY_REPOSITORY)
      .useValue(deliveries)
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
    inbound.rows.clear();
    endpoints.rows.clear();
    deliveries.rows.clear();
    deliveries.environmentOf.clear();
    deliveries.typeOf.clear();
    deliveries.subjectOf.clear();

    await seedUser('compliance@tokenone.com.br', 'COMPLIANCE');

    await inbound.claim({
      id: newId('evt'),
      environment: Environment.HOMOLOGACAO,
      connectionId: 'con_teste',
      provider: 'MOCK_BANK',
      dedupeKey: 'mb:1',
      providerEventId: 'mb-1',
      eventTypeRaw: 'account.status_changed',
      receivedAt: new Date('2026-08-30T11:00:00.000Z'),
      headers: { 'x-mockbank-signature': 't=1,v1=abc' },
      payload: Buffer.from(JSON.stringify({ tipo: 'account.status_changed' }), 'utf8'),
      rawSha256: 'a'.repeat(64),
      signatureValid: true,
      status: 'PROCESSED',
      attempts: 1,
    });

    // Um evento de PRODUCAO, para provar que a listagem de homologacao nao o ve.
    await inbound.claim({
      id: newId('evt'),
      environment: Environment.PRODUCAO,
      connectionId: 'con_producao',
      provider: 'MOCK_BANK',
      dedupeKey: 'mb:2',
      eventTypeRaw: 'pix_in.received',
      receivedAt: new Date('2026-08-30T11:30:00.000Z'),
      headers: {},
      payload: Buffer.from('{}', 'utf8'),
      rawSha256: 'b'.repeat(64),
      signatureValid: true,
      status: 'PROCESSED',
      attempts: 1,
    });

    const endpointId = newId('whe');
    endpoints.rows.set(endpointId, {
      id: endpointId,
      environment: Environment.HOMOLOGACAO,
      url: 'https://cliente.example.com/hooks',
      eventTypes: [],
      secret: envelope(SENTINELA),
      previousSecret: envelope(SENTINELA),
      previousSecretExpiresAt: new Date('2026-09-01T00:00:00.000Z'),
      status: 'ACTIVE',
      consecutiveFailures: 0,
      updatedAt: new Date('2026-08-30T10:00:00.000Z'),
    });

    const deliveryId = newId('whd');
    const eventId = newId('evt');
    deliveries.rows.set(deliveryId, {
      id: deliveryId,
      eventId,
      endpointId,
      attempt: 1,
      status: 'SUCCEEDED',
      scheduledFor: new Date('2026-08-30T11:00:01.000Z'),
      attemptedAt: new Date('2026-08-30T11:00:02.000Z'),
      responseStatus: 200,
    });
    deliveries.environmentOf.set(eventId, Environment.HOMOLOGACAO);
    deliveries.typeOf.set(eventId, 'pix.out.settled');
    deliveries.subjectOf.set(eventId, { kind: 'transaction', id: 'txn_teste' });
  });

  const token = async (email: string): Promise<string> => {
    const response = await fetch(`${baseUrl}/admin/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: SENHA }),
    });
    return ((await response.json()) as { access_token: string }).access_token;
  };

  const api = (path: string, jwt: string) =>
    fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${jwt}` } });

  it('lista eventos de entrada do ambiente pedido, e so dele', async () => {
    const jwt = await token('compliance@tokenone.com.br');
    const corpo = (await api('/admin/v1/webhooks/inbound?environment=HOMOLOGACAO', jwt).then((r) =>
      r.json(),
    )) as { data: Array<{ event_type_raw: string; payload: unknown }> };

    expect(corpo.data).toHaveLength(1);
    expect(corpo.data[0]!.event_type_raw).toBe('account.status_changed');
    // O `Buffer` do dobro sai como JSON, e nao como `{"type":"Buffer",...}`.
    expect(corpo.data[0]!.payload).toEqual({ tipo: 'account.status_changed' });
  });

  it('nega ler um evento de PRODUCAO por id numa sessao de HOMOLOGACAO', async () => {
    const jwt = await token('compliance@tokenone.com.br');
    const producao = [...inbound.rows.values()].find(
      (row) => row.environment === Environment.PRODUCAO,
    )!;

    const resposta = await api(
      `/admin/v1/webhooks/inbound/${producao.id}?environment=HOMOLOGACAO`,
      jwt,
    );
    expect(resposta.status).toBe(404);

    // O evento de HOMOLOGACAO, pelo mesmo caminho, e legivel — senao o teste
    // acima passaria por a rota estar quebrada, e nao pela regra de ambiente.
    const homologacao = [...inbound.rows.values()].find(
      (row) => row.environment === Environment.HOMOLOGACAO,
    )!;
    const certo = await api(
      `/admin/v1/webhooks/inbound/${homologacao.id}?environment=HOMOLOGACAO`,
      jwt,
    );
    expect(certo.status).toBe(200);
  });

  it('o endpoint sai sem o segredo, com set e rotating no lugar', async () => {
    const jwt = await token('compliance@tokenone.com.br');
    const resposta = await api('/admin/v1/webhooks/endpoints?environment=HOMOLOGACAO', jwt);
    const texto = await resposta.text();
    expect(resposta.status, texto).toBe(200);

    expect(texto).not.toContain(SENTINELA);
    expect(JSON.parse(texto)).toMatchObject({
      data: [
        {
          url: 'https://cliente.example.com/hooks',
          secret_set: true,
          secret_rotating: true,
        },
      ],
    });
  });

  it('a entrega carrega o tipo e o sujeito do evento', async () => {
    const jwt = await token('compliance@tokenone.com.br');
    const corpo = (await api('/admin/v1/webhooks/deliveries?environment=HOMOLOGACAO', jwt).then(
      (r) => r.json(),
    )) as { data: Array<{ event_type: string; subject_id: string }> };

    expect(corpo.data).toHaveLength(1);
    expect(corpo.data[0]).toMatchObject({
      event_type: 'pix.out.settled',
      subject_id: 'txn_teste',
      status: 'SUCCEEDED',
    });
  });

  it('exige sessao: sem token, 401 — a guarda de superficie e por caminho', async () => {
    const resposta = await fetch(`${baseUrl}/admin/v1/webhooks/inbound?environment=HOMOLOGACAO`);
    expect(resposta.status).toBe(401);
  });
});
