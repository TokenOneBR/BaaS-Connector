import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import express from 'express';

import { AppModule } from '../src/app.module.js';

/**
 * Exercita a aplicacao HTTP montada.
 *
 * Compilar o modulo prova que o grafo resolve; so uma requisicao de verdade
 * prova que middleware, filtro e roteamento estao na ordem certa — que e onde
 * os erros de montagem aparecem.
 */
describe('aplicacao HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://baas:baas@127.0.0.1:5432/baas?schema=public';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    app.use(express.json({ limit: '1mb' }));

    // Porta efemera e socket real: o caminho de rede completo, incluindo os
    // cabecalhos que o filtro escreve na resposta.
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('serve /healthz sem autenticacao', async () => {
    const response = await fetch(`${baseUrl}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('correlaciona toda resposta com um X-Request-Id', async () => {
    const response = await fetch(`${baseUrl}/healthz`);
    // Sem isso, um ticket de suporte com um print da resposta nao tem como
    // ser ligado a nenhuma linha de log.
    expect(response.headers.get('x-request-id')).toMatch(/^evt_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('preserva o X-Request-Id enviado pelo cliente', async () => {
    const response = await fetch(`${baseUrl}/healthz`, {
      headers: { 'X-Request-Id': 'evt_01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    });
    expect(response.headers.get('x-request-id')).toBe('evt_01ARZ3NDEKTSV4RRFFQ69G5FAV');
  });

  it('devolve rota inexistente no envelope canonico de erro', async () => {
    const response = await fetch(`${baseUrl}/v1/rota-que-nao-existe`);
    expect(response.status).toBe(404);

    // Nenhuma excecao vaza forma interna: um 404 do roteador do Nest sai com
    // o mesmo formato de um erro de dominio.
    const body = (await response.json()) as { error: Record<string, unknown> };
    expect(body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(body.error).toHaveProperty('category');
    expect(body.error).toHaveProperty('message_ptbr');
    expect(body.error.request_id).toBe(response.headers.get('x-request-id'));
  });

  it('nao expoe stack trace nem forma interna no corpo do erro', async () => {
    const response = await fetch(`${baseUrl}/v1/rota-que-nao-existe`);
    const raw = await response.text();
    expect(raw).not.toContain('node_modules');
    expect(raw).not.toContain('at Object');
    expect(raw.toLowerCase()).not.toContain('stack');
  });
});
