import {
  EnvelopeCrypto,
  type ClaimedOutboxEvent,
  type WebhookEndpointRecord,
} from '@baasconn/api/domain';
import {
  MemoryOutboxDispatchRepository,
  MemoryWebhookDeliveryRepository,
  MemoryWebhookEndpointRepository,
} from '@baasconn/api/testing';
import { LocalKmsDriver, verifyWebhookSignature } from '@baasconn/crypto';
import {
  Environment,
  EventType,
  FixedClock,
  WEBHOOK_HEADERS,
  WEBHOOK_RETRY_SCHEDULE_SECONDS,
  newId,
} from '@baasconn/taxonomy';
import { Metrics } from '@baasconn/observability';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EndpointSecrets } from '../../src/outbox/endpoint-secrets.js';
import { OutboxDispatcherService } from '../../src/outbox/outbox-dispatcher.service.js';
import { WebhookTransport } from '../../src/outbox/webhook-transport.js';
import { EndpointServer } from '../support/endpoint-server.js';

const ENV = Environment.HOMOLOGACAO;
const MASTER = 'chave-mestra-local-de-teste-com-tamanho';
const SEGREDO = 'whsec_do_endpoint';

describe('despacho de outbox contra endpoint real', () => {
  let server: EndpointServer;
  let url: string;
  let clock: FixedClock;
  let outbox: MemoryOutboxDispatchRepository;
  let endpoints: MemoryWebhookEndpointRepository;
  let deliveries: MemoryWebhookDeliveryRepository;
  let dispatcher: OutboxDispatcherService;
  let enfileirados: Array<{ deliveryId: string; delayMs?: number }>;
  let endpoint: WebhookEndpointRecord;

  const evento = (overrides: Partial<ClaimedOutboxEvent> = {}): ClaimedOutboxEvent => ({
    id: newId('event'),
    environment: ENV,
    type: EventType.PIX_OUT_SETTLED,
    dataVersion: 1,
    provider: 'MOCK_BANK',
    connectionId: 'con_1',
    subjectKind: 'transaction',
    subjectId: 'txn_1',
    sequence: 1n,
    payload: { status: 'SETTLED', amount_cents: '15000' },
    occurredAt: clock.now(),
    createdAt: clock.now(),
    ...overrides,
  });

  beforeEach(async () => {
    server = new EndpointServer();
    url = await server.start();
    clock = new FixedClock(new Date('2026-08-29T12:00:00.000Z'));

    outbox = new MemoryOutboxDispatchRepository();
    endpoints = new MemoryWebhookEndpointRepository();
    deliveries = new MemoryWebhookDeliveryRepository();
    enfileirados = [];

    const crypto = new EnvelopeCrypto({ kms: new LocalKmsDriver(MASTER) });
    const envelope = await crypto.encrypt(SEGREDO);

    endpoint = {
      id: newId('webhookEndpoint'),
      environment: ENV,
      url,
      eventTypes: [],
      secret: {
        ciphertext: envelope.ciphertext,
        iv: envelope.iv,
        authTag: envelope.authTag,
        wrappedKey: envelope.wrappedKey,
        keyId: envelope.keyId,
        version: envelope.version,
      },
      previousSecret: null,
      previousSecretExpiresAt: null,
      status: 'ACTIVE',
      consecutiveFailures: 0,
      updatedAt: clock.now(),
    };
    endpoints.rows.set(endpoint.id, endpoint);

    const queue = {
      enqueue: async (job: { deliveryId?: string }, options?: { delayMs?: number }) => {
        enfileirados.push({ deliveryId: job.deliveryId!, delayMs: options?.delayMs });
      },
      drain: async () => undefined,
    };

    dispatcher = new OutboxDispatcherService(
      new WebhookTransport(),
      new EndpointSecrets(crypto, clock),
      new Metrics(),
      outbox,
      endpoints,
      deliveries,
      queue as never,
      clock,
    );
  });

  afterEach(async () => {
    await server.stop();
  });

  /** Planeja o fan-out e entrega a primeira tentativa. */
  async function despachar(event: ClaimedOutboxEvent): Promise<void> {
    outbox.rows.set(event.id, { ...event });
    deliveries.sequenceOf.set(event.id, event.sequence);
    deliveries.subjectOf.set(event.id, { kind: event.subjectKind, id: event.subjectId });
    await dispatcher.claimAndFanOut();
    const primeira = enfileirados.shift()!;
    await dispatcher.deliver(primeira.deliveryId, event);
  }

  it('entrega com assinatura que o cliente consegue verificar', async () => {
    const event = evento();
    await despachar(event);

    expect(server.received).toHaveLength(1);
    const recebida = server.received[0]!;

    const verificacao = verifyWebhookSignature({
      header: recebida.headers[WEBHOOK_HEADERS.SIGNATURE]!,
      payload: recebida.body,
      secrets: [SEGREDO],
      nowSeconds: Math.floor(clock.now().getTime() / 1000),
      toleranceSeconds: 300,
    });
    expect(verificacao).toEqual({ valid: true });
  });

  it('o corpo carrega o envelope canonico, com sequence em string', async () => {
    const event = evento({ sequence: 9_007_199_254_740_993n });
    await despachar(event);

    const corpo = JSON.parse(server.received[0]!.body) as Record<string, unknown>;
    expect(corpo.object).toBe('event');
    expect(corpo.type).toBe(EventType.PIX_OUT_SETTLED);
    // `bigint` faz `JSON.stringify` lancar, e acima de 2^53 um number perde
    // precisao: string e a unica forma que atravessa o wire intacta.
    expect(corpo.sequence).toBe('9007199254740993');
    expect(corpo.livemode).toBe(false);
  });

  it('manda os cabecalhos de identidade e a chave de idempotencia', async () => {
    const event = evento();
    await despachar(event);
    const headers = server.received[0]!.headers;

    expect(headers[WEBHOOK_HEADERS.EVENT_ID]).toBe(event.id);
    expect(headers[WEBHOOK_HEADERS.ATTEMPT]).toBe('1');
    expect(headers[WEBHOOK_HEADERS.ENVIRONMENT]).toBe(ENV);
    // Dedupe de graca: um consumidor que ja trate idempotencia nao precisa de
    // codigo novo para nos.
    expect(headers['idempotency-key']).toBe(event.id);
  });

  it('marca dispatchedAt na reivindicacao, entao o evento nao sai duas vezes', async () => {
    const event = evento();
    outbox.rows.set(event.id, { ...event });

    await dispatcher.claimAndFanOut();
    const primeiraLeva = enfileirados.length;
    await dispatcher.claimAndFanOut();

    expect(primeiraLeva).toBe(1);
    expect(enfileirados).toHaveLength(1);
  });

  it('410 desabilita o endpoint e encerra o que estava na fila', async () => {
    const pendente = evento({ subjectId: 'txn_outro' });
    outbox.rows.set(pendente.id, { ...pendente });
    await dispatcher.claimAndFanOut();
    enfileirados.length = 0;

    server.responderCom(410);
    const event = evento({ sequence: 2n });
    await despachar(event);

    expect((await endpoints.findById(endpoint.id))?.status).toBe('DISABLED_BY_FAILURES');
    // Continuar batendo depois de um 410 e ignorar o que o cliente disse.
    const restantes = [...deliveries.rows.values()].filter((d) => d.status === 'PENDING');
    expect(restantes).toHaveLength(0);
  });

  it('500 reagenda no primeiro degrau da escada', async () => {
    server.responderCom(500);
    await despachar(evento());

    const reagendada = enfileirados.at(-1)!;
    const base = WEBHOOK_RETRY_SCHEDULE_SECONDS[0]! * 1000;
    expect(reagendada.delayMs).toBeGreaterThanOrEqual(base * 0.8);
    expect(reagendada.delayMs).toBeLessThanOrEqual(base * 1.2);
  });

  it('429 com Retry-After maior vence a escada', async () => {
    server.responderCom(429, { 'retry-after': '600' });
    await despachar(evento());

    expect(enfileirados.at(-1)!.delayMs).toBe(600_000);
  });

  it('nao segue redirect', async () => {
    // Seguir mandaria payload assinado, com dado de pagamento, para um host
    // escolhido por quem respondeu.
    server.responderCom(302, { location: 'http://127.0.0.1:1/roubado' });
    await despachar(evento());

    expect(server.received).toHaveLength(1);
    const entrega = [...deliveries.rows.values()][0]!;
    expect(entrega.status).toBe('FAILED');
    expect(entrega.error).toContain('redirect');
  });

  it('espera a entrega anterior do mesmo assunto', async () => {
    const primeiro = evento({ sequence: 1n, type: EventType.PIX_OUT_PENDING });
    outbox.rows.set(primeiro.id, { ...primeiro });
    deliveries.sequenceOf.set(primeiro.id, 1n);
    deliveries.subjectOf.set(primeiro.id, { kind: 'transaction', id: 'txn_1' });
    await dispatcher.claimAndFanOut();
    enfileirados.length = 0;

    const segundo = evento({ sequence: 2n });
    outbox.rows.set(segundo.id, { ...segundo });
    deliveries.sequenceOf.set(segundo.id, 2n);
    deliveries.subjectOf.set(segundo.id, { kind: 'transaction', id: 'txn_1' });
    await dispatcher.claimAndFanOut();

    const doSegundo = enfileirados.find((e) => {
      const entrega = deliveries.rows.get(e.deliveryId);
      return entrega?.eventId === segundo.id;
    })!;
    await dispatcher.deliver(doSegundo.deliveryId, segundo);

    // Para quem consome pagamento, `settled` antes de `pending` e pior do que
    // `settled` tarde.
    expect(server.received).toHaveLength(0);
    expect(enfileirados.at(-1)?.delayMs).toBe(200);
  });

  it('filtra por tipo de evento', async () => {
    endpoint.eventTypes = ['pix_in.*'];
    const event = evento({ type: EventType.PIX_OUT_SETTLED });
    outbox.rows.set(event.id, { ...event });

    await dispatcher.claimAndFanOut();
    expect(enfileirados).toHaveLength(0);
  });

  it('a rotacao manda os dois segredos', async () => {
    const crypto = new EnvelopeCrypto({ kms: new LocalKmsDriver(MASTER) });
    const anterior = await crypto.encrypt('whsec_anterior');
    endpoint.previousSecret = {
      ciphertext: anterior.ciphertext,
      iv: anterior.iv,
      authTag: anterior.authTag,
      wrappedKey: anterior.wrappedKey,
      keyId: anterior.keyId,
      version: anterior.version,
    };
    endpoint.previousSecretExpiresAt = new Date(clock.now().getTime() + 3_600_000);

    await despachar(evento());
    const header = server.received[0]!.headers[WEBHOOK_HEADERS.SIGNATURE]!;

    // O cliente troca o segredo quando quiser dentro da janela, sem perder
    // evento.
    for (const secret of [SEGREDO, 'whsec_anterior']) {
      expect(
        verifyWebhookSignature({
          header,
          payload: server.received[0]!.body,
          secrets: [secret],
          nowSeconds: Math.floor(clock.now().getTime() / 1000),
          toleranceSeconds: 300,
        }),
      ).toEqual({ valid: true });
    }
  });

  it('segredo anterior vencido nao e mais enviado', async () => {
    const crypto = new EnvelopeCrypto({ kms: new LocalKmsDriver(MASTER) });
    const anterior = await crypto.encrypt('whsec_anterior');
    endpoint.previousSecret = {
      ciphertext: anterior.ciphertext,
      iv: anterior.iv,
      authTag: anterior.authTag,
      wrappedKey: anterior.wrappedKey,
      keyId: anterior.keyId,
      version: anterior.version,
    };
    endpoint.previousSecretExpiresAt = new Date(clock.now().getTime() - 1_000);

    await despachar(evento());
    expect(server.received[0]!.headers[WEBHOOK_HEADERS.SIGNATURE]!.match(/v1=/g)).toHaveLength(1);
  });
});
