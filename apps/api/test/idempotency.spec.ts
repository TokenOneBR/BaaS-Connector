import {
  BaasError,
  BaasErrorCode,
  ProviderOutcomeUnknownError,
  newId,
  systemClock,
} from '@baasconn/taxonomy';
import { Reflector } from '@nestjs/core';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  canonicalJson,
  fingerprintRequest,
  Idempotent,
  IdempotencyInterceptor,
  isDeterministic,
  IDEMPOTENT_KEY,
} from '../src/idempotency/idempotency.interceptor.js';
import {
  IDEMPOTENCY_REQUIRED_CLASSES,
  IDEMPOTENCY_TTL_SECONDS,
  type ClaimResult,
  type IdempotencyRecord,
  type IdempotencyRepository,
} from '../src/idempotency/idempotency.types.js';

/** Repositorio em memoria com a semantica de INSERT ... ON CONFLICT. */
class MemoryRepository implements IdempotencyRepository {
  readonly records = new Map<string, IdempotencyRecord>();
  released: string[] = [];

  private index(environment: string, endpointKey: string, key: string): string {
    return `${environment}|${endpointKey}|${key}`;
  }

  async claim(input: Parameters<IdempotencyRepository['claim']>[0]): Promise<ClaimResult> {
    const index = this.index(input.environment, input.endpointKey, input.key);
    const existing = this.records.get(index);
    if (existing) return { claimed: false, record: existing, stolen: false };

    const record: IdempotencyRecord = {
      id: newId('idempotency'),
      environment: input.environment,
      apiKeyId: input.apiKeyId,
      endpointKey: input.endpointKey,
      key: input.key,
      requestFingerprint: input.requestFingerprint,
      state: 'IN_FLIGHT',
      operationId: newId('operation'),
      leaseExpiresAt: new Date(Date.now() + input.leaseSeconds * 1000),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + input.ttlSeconds * 1000),
    };
    this.records.set(index, record);
    return { claimed: true, record, stolen: false };
  }

  async find(environment: string, endpointKey: string, key: string) {
    return this.records.get(this.index(environment, endpointKey, key));
  }

  async stealLease(id: string, leaseSeconds: number) {
    for (const record of this.records.values()) {
      if (record.id !== id) continue;
      if (record.leaseExpiresAt && record.leaseExpiresAt > new Date()) return undefined;
      record.leaseExpiresAt = new Date(Date.now() + leaseSeconds * 1000);
      return record;
    }
    return undefined;
  }

  async renewLease(id: string, leaseSeconds: number) {
    for (const record of this.records.values()) {
      if (record.id === id) record.leaseExpiresAt = new Date(Date.now() + leaseSeconds * 1000);
    }
  }

  async complete(input: Parameters<IdempotencyRepository['complete']>[0]) {
    for (const record of this.records.values()) {
      if (record.id !== input.id) continue;
      record.state = input.state;
      record.responseStatus = input.status;
      record.responseBody = input.body;
      record.errorCode = input.errorCode ?? null;
      record.completedAt = new Date();
    }
  }

  async release(id: string) {
    this.released.push(id);
    for (const [index, record] of this.records) {
      if (record.id === id) this.records.delete(index);
    }
  }

  expireLease(id: string): void {
    for (const record of this.records.values()) {
      if (record.id === id) record.leaseExpiresAt = new Date(Date.now() - 1000);
    }
  }
}

function makeContext(request: Record<string, unknown>, response: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

function makeResponse() {
  const headers: Record<string, string> = {};
  let status = 200;
  return {
    headers,
    get status() {
      return status;
    },
    api: {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
      status: (code: number) => {
        status = code;
      },
    },
  };
}

describe('interceptor de idempotencia', () => {
  let repository: MemoryRepository;
  let reflector: Reflector;
  let interceptor: IdempotencyInterceptor;

  const options = { operationClass: 'pix.out' as const };

  beforeEach(() => {
    repository = new MemoryRepository();
    reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: unknown) =>
      key === IDEMPOTENT_KEY ? options : undefined,
    );
    interceptor = new IdempotencyInterceptor(repository, reflector, systemClock);
  });

  const baseRequest = (overrides: Record<string, unknown> = {}) => ({
    method: 'POST',
    headers: { 'idempotency-key': 'chave-do-cliente-1' },
    body: { amount: { amount: '10000', currency: 'BRL', scale: 2 } },
    params: {},
    query: {},
    apiKey: { id: 'key_1', environment: 'HOMOLOGACAO' },
    ...overrides,
  });

  const run = async (request: Record<string, unknown>, handler: CallHandler) => {
    const response = makeResponse();
    const result = await (
      interceptor.intercept(makeContext(request, response.api), handler) as never as {
        toPromise?: () => Promise<unknown>;
      }
    );
    // O interceptor devolve um Observable; convertemos para promessa.
    const value = await new Promise((resolve, reject) => {
      (result as unknown as { subscribe: (o: unknown) => void }).subscribe({
        next: resolve,
        error: reject,
      });
    });
    return { value, response };
  };

  it('executa o handler e grava a resposta na primeira chamada', async () => {
    const handler = { handle: () => of({ id: 'txn_1' }) };
    const { value } = await run(baseRequest(), handler);

    expect(value).toEqual({ id: 'txn_1' });
    const [record] = [...repository.records.values()];
    expect(record?.state).toBe('COMPLETED');
    expect(record?.responseBody).toEqual({ id: 'txn_1' });
  });

  it('reproduz a resposta gravada quando a chave repete', async () => {
    const first = { handle: vi.fn(() => of({ id: 'txn_1' })) };
    await run(baseRequest(), first);

    const second = { handle: vi.fn(() => of({ id: 'txn_2' })) };
    const { value, response } = await run(baseRequest(), second);

    // O handler NAO roda de novo: e o que garante um efeito colateral so.
    expect(second.handle).not.toHaveBeenCalled();
    expect(value).toEqual({ id: 'txn_1' });
    expect(response.headers['Idempotency-Replayed']).toBe('true');
  });

  it('recusa a mesma chave com corpo diferente', async () => {
    await run(baseRequest(), { handle: () => of({ id: 'txn_1' }) });

    const different = baseRequest({
      body: { amount: { amount: '99999', currency: 'BRL', scale: 2 } },
    });
    await expect(run(different, { handle: () => of({}) })).rejects.toMatchObject({
      code: BaasErrorCode.IDEMPOTENCY_KEY_REUSED,
    });
  });

  it('devolve 409 quando ha requisicao em voo com lease vivo', async () => {
    // Simula uma requisicao que reservou a chave e ainda esta rodando.
    await repository.claim({
      environment: 'HOMOLOGACAO' as never,
      apiKeyId: 'key_1',
      endpointKey: 'POST Controller.handler',
      key: 'chave-do-cliente-1',
      requestFingerprint: fingerprintRequest(baseRequest() as never),
      leaseSeconds: 90,
      ttlSeconds: 60,
    });

    await expect(run(baseRequest(), { handle: () => of({}) })).rejects.toMatchObject({
      code: BaasErrorCode.IDEMPOTENT_REQUEST_IN_PROGRESS,
    });
  });

  it('rouba lease abandonado e marca que precisa reconciliar antes', async () => {
    const claim = await repository.claim({
      environment: 'HOMOLOGACAO' as never,
      apiKeyId: 'key_1',
      endpointKey: 'POST Controller.handler',
      key: 'chave-do-cliente-1',
      requestFingerprint: fingerprintRequest(baseRequest() as never),
      leaseSeconds: 90,
      ttlSeconds: 60,
    });
    repository.expireLease(claim.record.id);

    const request = baseRequest();
    await run(request, { handle: () => of({ id: 'txn_1' }) });

    // Quem rouba o lease PRECISA consultar o provedor antes de reexecutar: a
    // tentativa anterior pode ter chegado la.
    expect(request).toMatchObject({ reconcileBeforeExecute: true });
  });

  it('exige a chave em rota que movimenta dinheiro', async () => {
    const request = baseRequest({ headers: {} });
    await expect(run(request, { handle: () => of({}) })).rejects.toMatchObject({
      code: BaasErrorCode.MISSING_IDEMPOTENCY_KEY,
    });
  });

  it('recusa chave em formato invalido', async () => {
    const request = baseRequest({ headers: { 'idempotency-key': 'curta' } });
    await expect(run(request, { handle: () => of({}) })).rejects.toMatchObject({
      code: BaasErrorCode.VALIDATION_ERROR,
    });
  });

  it('injeta o operationId na requisicao, que vira a chave do PROVEDOR', async () => {
    const request = baseRequest();
    await run(request, { handle: () => of({}) });
    // Nunca a chave do cliente: formatos arbitrarios violam regra de provedor,
    // e o namespace precisa ser nosso.
    expect(request).toHaveProperty('operationId');
    expect((request as { operationId: string }).operationId).not.toBe('chave-do-cliente-1');
  });

  describe('tratamento de falha', () => {
    it('grava falha deterministica e a reproduz no retry', async () => {
      const error = new BaasError(BaasErrorCode.INSUFFICIENT_FUNDS);
      await expect(
        run(baseRequest(), { handle: () => throwError(() => error) }),
      ).rejects.toBeInstanceOf(BaasError);

      const [record] = [...repository.records.values()];
      expect(record?.state).toBe('FAILED');

      // Retry devolve o mesmo erro sem ir ao provedor de novo.
      const handler = { handle: vi.fn(() => of({})) };
      const { value } = await run(baseRequest(), handler);
      expect(handler.handle).not.toHaveBeenCalled();
      expect(value).toMatchObject({ error: { code: BaasErrorCode.INSUFFICIENT_FUNDS } });
    });

    it('libera o registro em falha transitoria, dando tentativa nova ao cliente', async () => {
      const error = new BaasError(BaasErrorCode.PROVIDER_UNAVAILABLE);
      await expect(
        run(baseRequest(), { handle: () => throwError(() => error) }),
      ).rejects.toBeInstanceOf(BaasError);

      expect(repository.released).toHaveLength(1);
      expect(repository.records.size).toBe(0);
    });

    it('NAO libera o registro em desfecho desconhecido', async () => {
      // Liberar aqui permitiria o cliente reenviar um pagamento que pode ter
      // sido processado. Este e o caso que justifica todo o mecanismo.
      const error = new ProviderOutcomeUnknownError('MOCK_BANK', 'opr_1');
      await expect(
        run(baseRequest(), { handle: () => throwError(() => error) }),
      ).rejects.toBeInstanceOf(ProviderOutcomeUnknownError);

      expect(repository.released).toHaveLength(0);
      const [record] = [...repository.records.values()];
      expect(record?.state).toBe('IN_FLIGHT');
      expect(record?.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    });
  });
});

describe('classificacao de falha', () => {
  it('trata erro de regra de negocio como deterministico', () => {
    expect(isDeterministic(new BaasError(BaasErrorCode.INSUFFICIENT_FUNDS))).toBe(true);
    expect(isDeterministic(new BaasError(BaasErrorCode.INVALID_TAX_ID))).toBe(true);
    expect(isDeterministic(new BaasError(BaasErrorCode.CAPABILITY_NOT_SUPPORTED))).toBe(true);
  });

  it('trata erro de infraestrutura como transitorio', () => {
    expect(isDeterministic(new BaasError(BaasErrorCode.PROVIDER_UNAVAILABLE))).toBe(false);
    expect(isDeterministic(new BaasError(BaasErrorCode.INTERNAL_ERROR))).toBe(false);
    expect(isDeterministic(new BaasError(BaasErrorCode.PROVIDER_TIMEOUT))).toBe(false);
  });
});

describe('impressao digital da requisicao', () => {
  it('e estavel a ordem das chaves do JSON', () => {
    const a = fingerprintRequest({ body: { amount: 100, key: 'x' }, params: {}, query: {} });
    const b = fingerprintRequest({ body: { key: 'x', amount: 100 }, params: {}, query: {} });
    expect(a).toBe(b);
  });

  it('muda quando o valor muda', () => {
    const a = fingerprintRequest({ body: { amount: 100 }, params: {}, query: {} });
    const b = fingerprintRequest({ body: { amount: 101 }, params: {}, query: {} });
    expect(a).not.toBe(b);
  });

  it('inclui a conexao: a mesma chave em conexoes diferentes e outra operacao', () => {
    const a = fingerprintRequest({ body: {}, params: {}, query: { connection_id: 'con_1' } });
    const b = fingerprintRequest({ body: {}, params: {}, query: { connection_id: 'con_2' } });
    expect(a).not.toBe(b);
  });

  it('canonicalJson ordena chaves recursivamente', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('canonicalJson ignora undefined', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe('politica de TTL', () => {
  it('movimentacao de dinheiro tem TTL de 7 dias', () => {
    // Disputa e loop de retry duram dias; e a janela que as regras de
    // devolucao do BACEN consideram.
    expect(IDEMPOTENCY_TTL_SECONDS['pix.out']).toBe(7 * 86_400);
    expect(IDEMPOTENCY_TTL_SECONDS['pix.refund']).toBe(7 * 86_400);
  });

  it('criacao de conta tambem, porque duplicar conta e incidente de compliance', () => {
    expect(IDEMPOTENCY_TTL_SECONDS['accounts.create']).toBe(7 * 86_400);
  });

  it('a chave e obrigatoria em toda rota que movimenta dinheiro', () => {
    expect(IDEMPOTENCY_REQUIRED_CLASSES.has('pix.out')).toBe(true);
    expect(IDEMPOTENCY_REQUIRED_CLASSES.has('pix.refund')).toBe(true);
    expect(IDEMPOTENCY_REQUIRED_CLASSES.has('accounts.create')).toBe(true);
    // Leitura e criacao de chave Pix nao exigem, mas honram quando enviada.
    expect(IDEMPOTENCY_REQUIRED_CLASSES.has('pix.keys.create')).toBe(false);
  });

  it('o decorator carrega a classe de operacao', () => {
    const decorator = Idempotent({ operationClass: 'pix.out' });
    expect(typeof decorator).toBe('function');
  });
});
