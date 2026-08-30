import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { buildSignature, verifyWebhookSignature, buildWebhookSignature } from '@baasconn/crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  BaasApiError,
  BaasConnector,
  BaasOutcomeUnknown,
  BaasTransportError,
} from '../src/index.js';

interface Recebida {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/**
 * Servidor HTTP DE VERDADE, em porta efemera.
 *
 * Nao `nock`, nao `msw`. O SDK e uma pilha HTTP: o que interessa provar e o
 * que sai na rede — o cabecalho de assinatura, o corpo exato que entrou no
 * digest, o timeout, o status 202. Uma biblioteca de interceptacao mocka
 * exatamente a camada que queremos testar, e e o mesmo raciocinio que fez o
 * `CassetteServer` da suite de conformidade existir.
 */
class Servidor {
  private servidor?: Server;
  readonly recebidas: Recebida[] = [];
  responder: (req: Recebida, res: ServerResponse) => void = (_, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  };

  async start(): Promise<string> {
    this.servidor = createServer((req: IncomingMessage, res: ServerResponse) => {
      const partes: Buffer[] = [];
      req.on('data', (parte: Buffer) => partes.push(parte));
      req.on('end', () => {
        const recebida: Recebida = {
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          body: Buffer.concat(partes).toString('utf8'),
        };
        this.recebidas.push(recebida);
        this.responder(recebida, res);
      });
    });

    await new Promise<void>((resolve) => this.servidor!.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(this.servidor!.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.servidor?.close(() => resolve()));
  }
}

const SIGNING_SECRET = 'segredo-de-assinatura-do-sdk';

describe('BaasConnector', () => {
  const servidor = new Servidor();
  let baseUrl: string;

  beforeAll(async () => {
    baseUrl = await servidor.start();
  });
  afterAll(async () => {
    await servidor.stop();
  });

  const cliente = (apiKey = 'bck_hml_key_secret'): BaasConnector =>
    new BaasConnector({
      baseUrl,
      apiKey,
      signingSecret: SIGNING_SECRET,
      now: () => 1_700_000_000_000,
    });

  it('o ambiente vem da CHAVE, e nao de um parametro', () => {
    // Uma opcao `environment` no construtor estaria a um typo de uma
    // transferencia PIX real. Nao existe, e nao pode passar a existir.
    expect(cliente('bck_hml_key_secret').environment).toBe('HOMOLOGACAO');
    expect(cliente('bck_prd_key_secret').environment).toBe('PRODUCAO');
    expect(cliente('formato-desconhecido').environment).toBe('UNKNOWN');
  });

  it('assina a transferencia sobre o corpo EXATO que envia', async () => {
    servidor.responder = (_, res) =>
      res.writeHead(201, { 'content-type': 'application/json' }).end('{"id":"txn_1"}');

    await cliente().pixTransfers.send('acc_1', {
      amount: { amount: '50000', currency: 'BRL', scale: 2 },
      destination: { type: 'KEY', key: 'chave@example.com' },
    } as never);

    const enviada = servidor.recebidas.at(-1)!;
    const assinatura = buildSignature(SIGNING_SECRET, {
      method: 'POST',
      path: '/v1/accounts/acc_1/pix/transfers',
      rawBody: enviada.body,
      timestamp: String(enviada.headers['x-baas-timestamp']),
      nonce: String(enviada.headers['x-baas-nonce']),
    });

    // A assinatura esperada e calculada a partir dos BYTES QUE CHEGARAM ao
    // servidor. Assinar um corpo vazio, ou um corpo diferente do enviado,
    // reprova — que e o unico jeito de o valor da transferencia nao poder ser
    // trocado em transito.
    expect(enviada.headers['x-baas-signature']).toBe(assinatura);
  });

  it('a query entra no caminho assinado', async () => {
    servidor.responder = (_, res) =>
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');

    await cliente().http.request(
      'POST',
      '/v1/accounts/acc_1/pix/transfers',
      { a: 1 },
      {
        query: { amount: '1' },
      },
    );

    const enviada = servidor.recebidas.at(-1)!;
    expect(enviada.url).toBe('/v1/accounts/acc_1/pix/transfers?amount=1');

    // Sem a query no caminho canonico, a assinatura de `?amount=1` valeria em
    // `?amount=1000000` — o servidor aceitaria o valor trocado.
    expect(enviada.headers['x-baas-signature']).toBe(
      buildSignature(SIGNING_SECRET, {
        method: 'POST',
        path: '/v1/accounts/acc_1/pix/transfers?amount=1',
        rawBody: enviada.body,
        timestamp: String(enviada.headers['x-baas-timestamp']),
        nonce: String(enviada.headers['x-baas-nonce']),
      }),
    );
  });

  it('NAO assina rota que nao move dinheiro', async () => {
    servidor.responder = (_, res) =>
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"id":"acc_1"}');

    await cliente().accounts.get('acc_1');
    expect(servidor.recebidas.at(-1)!.headers['x-baas-signature']).toBeUndefined();
  });

  it('gera chave de idempotencia quando a rota exige e o chamador omite', async () => {
    servidor.responder = (_, res) =>
      res.writeHead(201, { 'content-type': 'application/json' }).end('{"id":"txn_2"}');

    await cliente().pixTransfers.send('acc_1', {
      amount: { amount: '1', currency: 'BRL', scale: 2 },
    } as never);

    // Gerar e melhor que omitir: SEM chave, um retry de rede vira um segundo
    // pagamento. Com chave, vira uma repeticao sem efeito.
    expect(servidor.recebidas.at(-1)!.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('202 vira BaasOutcomeUnknown com o operation_id, e nao um sucesso', async () => {
    servidor.responder = (_, res) =>
      res
        .writeHead(202, { 'content-type': 'application/json' })
        .end('{"status":"processing","operation_id":"opr_9"}');

    // O 202 e um TERCEIRO desfecho: nem sucesso, nem falha. Devolve-lo como
    // transacao faria quem integra marcar o pagamento como enviado; devolve-lo
    // como erro faria reenviar. As duas custam dinheiro.
    await expect(
      cliente().pixTransfers.send('acc_1', {
        amount: { amount: '1', currency: 'BRL', scale: 2 },
      } as never),
    ).rejects.toMatchObject({ name: 'BaasOutcomeUnknown', operationId: 'opr_9' });
  });

  it('preserva o corpo de erro canonico inteiro', async () => {
    servidor.responder = (_, res) =>
      res.writeHead(422, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          error: {
            code: 'INSUFFICIENT_FUNDS',
            message: 'Insufficient funds.',
            message_ptbr: 'Saldo insuficiente.',
            request_id: 'req_1',
            provider: { slug: 'CELCOIN', code: 'CBE-1234', message: 'saldo indisponivel' },
          },
        }),
      );

    const erro = await cliente()
      .accounts.balance('acc_1')
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(BaasApiError);
    const api = erro as BaasApiError;
    // O codigo CRU do provedor sobrevive: e o que o suporte usa para escalar,
    // e traduzi-lo aqui perderia exatamente essa informacao.
    expect(api.body.provider?.code).toBe('CBE-1234');
    expect(api.message).toBe('Saldo insuficiente.');
    expect(api.requestId).toBe('req_1');
  });

  it('erro de saldo insuficiente NAO e seguro repetir', async () => {
    const erro = new BaasApiError(422, { code: 'INSUFFICIENT_FUNDS', message: 'x' });
    expect(erro.safeToRetry).toBe(false);

    // 429 e: o servidor pediu para esperar, e nada aconteceu do outro lado.
    expect(new BaasApiError(429, { code: 'RATE_LIMITED', message: 'x' }).safeToRetry).toBe(true);
  });

  it('falha de transporte e distinta de erro da API', async () => {
    const desconectado = new BaasConnector({
      baseUrl: 'http://127.0.0.1:1',
      apiKey: 'bck_hml_a_b',
      timeoutMs: 500,
    });

    // Provado que nada chegou ao servidor: repetir e seguro mesmo numa rota
    // de dinheiro, e o tipo diferente e o que permite decidir isso.
    await expect(desconectado.accounts.get('acc_1')).rejects.toBeInstanceOf(BaasTransportError);
  });

  it('o verificador de webhook e o MESMO que assina do outro lado', () => {
    const corpo = '{"type":"pix.in.received"}';
    const header = buildWebhookSignature({
      payload: corpo,
      timestampSeconds: 1_700_000_000,
      secrets: ['whsec_antigo', 'whsec_novo'],
    });

    // Durante a rotacao saem DOIS `v1=`. Um verificador que aceita qualquer
    // um dos dois e o que permite o cliente trocar o segredo sem perder
    // evento — e este e o mesmo codigo dos dois lados, nao uma copia.
    for (const segredo of ['whsec_antigo', 'whsec_novo']) {
      expect(
        verifyWebhookSignature({
          header,
          payload: corpo,
          secrets: [segredo],
          nowSeconds: 1_700_000_010,
          toleranceSeconds: 300,
        }),
      ).toEqual({ valid: true });
    }

    // Corpo adulterado recusa, e a janela e conferida ANTES do HMAC.
    expect(
      verifyWebhookSignature({
        header,
        payload: `${corpo} `,
        secrets: ['whsec_novo'],
        nowSeconds: 1_700_000_010,
        toleranceSeconds: 300,
      }),
    ).toEqual({ valid: false, reason: 'no_matching_signature' });

    expect(
      verifyWebhookSignature({
        header,
        payload: corpo,
        secrets: ['whsec_novo'],
        nowSeconds: 1_700_999_999,
        toleranceSeconds: 300,
      }),
    ).toEqual({ valid: false, reason: 'timestamp_out_of_window' });
  });
});
