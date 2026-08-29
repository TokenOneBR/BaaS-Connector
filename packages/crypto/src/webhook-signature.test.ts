import { describe, expect, it } from 'vitest';

import {
  buildWebhookSignature,
  parseSignatureHeader,
  verifyWebhookSignature,
} from './webhook-signature.js';

const AGORA = 1_772_000_000;
const CORPO = '{"id":"evt_1","type":"pix_out.settled"}';
const SEGREDO = 'segredo-do-endpoint';
const ANTERIOR = 'segredo-anterior';

const verify = (header: string, secrets: readonly string[], now = AGORA) =>
  verifyWebhookSignature({
    header,
    payload: CORPO,
    secrets,
    nowSeconds: now,
    toleranceSeconds: 300,
  });

describe('assinatura de webhook de saida', () => {
  it('ida e volta confere', () => {
    const header = buildWebhookSignature({
      payload: CORPO,
      timestampSeconds: AGORA,
      secrets: [SEGREDO],
    });
    expect(verify(header, [SEGREDO])).toEqual({ valid: true });
  });

  it('o formato e o da Stripe', () => {
    const header = buildWebhookSignature({
      payload: CORPO,
      timestampSeconds: AGORA,
      secrets: [SEGREDO],
    });
    // Ha snippet de verificacao em toda linguagem para este formato, e todo
    // dev brasileiro ja integrou com ele.
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });

  it('corpo adulterado nao confere', () => {
    const header = buildWebhookSignature({
      payload: CORPO,
      timestampSeconds: AGORA,
      secrets: [SEGREDO],
    });
    expect(
      verifyWebhookSignature({
        header,
        payload: `${CORPO} `,
        secrets: [SEGREDO],
        nowSeconds: AGORA,
        toleranceSeconds: 300,
      }),
    ).toMatchObject({ valid: false, reason: 'no_matching_signature' });
  });

  it('timestamp trocado invalida a assinatura', () => {
    // O timestamp entra na string ASSINADA, e nao so no cabecalho. Se ficasse
    // so no cabecalho, dava para troca-lo sem invalidar nada e a janela de
    // tolerancia nao significaria coisa nenhuma.
    const header = buildWebhookSignature({
      payload: CORPO,
      timestampSeconds: AGORA,
      secrets: [SEGREDO],
    });
    const forjado = header.replace(`t=${AGORA}`, `t=${AGORA + 10}`);

    expect(verify(forjado, [SEGREDO], AGORA + 10)).toMatchObject({
      valid: false,
      reason: 'no_matching_signature',
    });
  });

  it('assinatura velha e recusada mesmo sendo valida', () => {
    const header = buildWebhookSignature({
      payload: CORPO,
      timestampSeconds: AGORA,
      secrets: [SEGREDO],
    });
    // Replay: a assinatura confere, o instante nao.
    expect(verify(header, [SEGREDO], AGORA + 301)).toMatchObject({
      valid: false,
      reason: 'timestamp_out_of_window',
    });
  });

  it('a rotacao manda os dois segredos, e os dois conferem', () => {
    const header = buildWebhookSignature({
      payload: CORPO,
      timestampSeconds: AGORA,
      secrets: [SEGREDO, ANTERIOR],
    });

    expect(header.match(/v1=/g)).toHaveLength(2);
    // O cliente troca quando quiser dentro da janela, sem perder evento.
    expect(verify(header, [SEGREDO])).toEqual({ valid: true });
    expect(verify(header, [ANTERIOR])).toEqual({ valid: true });
  });

  it('segredo errado nao confere', () => {
    const header = buildWebhookSignature({
      payload: CORPO,
      timestampSeconds: AGORA,
      secrets: [SEGREDO],
    });
    expect(verify(header, ['outro-segredo'])).toMatchObject({
      valid: false,
      reason: 'no_matching_signature',
    });
  });

  it('cabecalho malformado nao lanca', () => {
    // Um cliente que manda lixo nao pode derrubar a verificacao com excecao.
    for (const lixo of ['', 'lixo', 't=abc,v1=x', 'v1=semtimestamp', `t=${AGORA}`]) {
      expect(verify(lixo, [SEGREDO])).toMatchObject({ valid: false });
    }
  });

  it('sem segredo, assinar e erro e nao silencio', () => {
    // Assinar com segredo vazio produziria um HMAC valido que ninguem consegue
    // verificar — pior do que falhar na hora.
    expect(() =>
      buildWebhookSignature({ payload: CORPO, timestampSeconds: AGORA, secrets: [] }),
    ).toThrow(/ao menos um segredo/);
  });

  it('o parser aceita ordem e espaco arbitrarios', () => {
    expect(parseSignatureHeader(` v1=abc , t=${AGORA} `)).toEqual({
      timestamp: AGORA,
      signatures: ['abc'],
    });
  });
});
