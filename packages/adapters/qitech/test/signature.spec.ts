import { generateKeyPairSync } from 'node:crypto';

import { AsymmetricJwtStrategy } from '@baasconn/adapter-kit';
import { FixedClock } from '@baasconn/taxonomy';
import { describe, expect, it } from 'vitest';

import { buildAuthStrategy } from '../src/auth.js';

/**
 * O modelo de autenticacao E o que este pacote entrega.
 *
 * A referencia de API da QI Tech fica atras de portal de parceiro, entao nao
 * ha capacidade declarada — mas a autenticacao esta na documentacao publica,
 * e e o unico dos cinco provedores que exigiu uma estrategia nova no kit.
 * Estes testes sao a prova de que ela funciona.
 */
describe('autenticacao da QI Tech', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-521',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });

  const clock = new FixedClock(new Date('2026-08-30T12:00:00.000Z'));

  const prepared = () => ({
    method: 'POST',
    path: '/baas/pix/payment',
    headers: {} as Record<string, string>,
    body: JSON.stringify({ amount: 15075 }),
    timestamp: clock.now().getTime(),
  });

  it('identifica com API key E assina com a chave privada', async () => {
    const strategy = buildAuthStrategy({ apiKey: 'chave-de-teste', privateKey });
    const request = prepared();
    await strategy.apply(request);

    // A API key diz QUEM; a assinatura prova que a requisicao nao mudou.
    // Uma sem a outra nao serve: a chave sozinha e um segredo compartilhado
    // que qualquer intermediario que a veja pode reusar.
    expect(request.headers['API-CLIENT-KEY']).toBe('chave-de-teste');
    expect(request.headers['content-type']).toBe('application/jwt');
    expect(request.body!.split('.')).toHaveLength(3);
  });

  it('o corpo assinado carrega metodo, caminho e payload', async () => {
    const strategy = buildAuthStrategy({ apiKey: 'chave-de-teste', privateKey });
    const request = prepared();
    await strategy.apply(request);

    const payload = await AsymmetricJwtStrategy.verifyResponse(request.body!, publicKey, 'ES512');

    // A assinatura cobre a requisicao INTEIRA. Assinar so o corpo deixaria um
    // intermediario redirecionar a mesma transferencia para outra rota.
    expect(payload).toMatchObject({
      sub: 'chave-de-teste',
      method: 'POST',
      path: '/baas/pix/payment',
      body: { amount: 15075 },
    });
  });

  it('sem chave privada, so identifica — e nao finge assinar', async () => {
    // E o estado do boot, que constroi todo adapter com credenciais vazias.
    // Fingir uma assinatura aqui produziria um JWS invalido que so falharia na
    // primeira chamada real.
    const strategy = buildAuthStrategy({ apiKey: 'chave-de-teste', privateKey: '' });
    const request = prepared();
    await strategy.apply(request);

    expect(request.headers['API-CLIENT-KEY']).toBe('chave-de-teste');
    expect(request.headers['content-type']).toBeUndefined();
    expect(request.body).toBe(JSON.stringify({ amount: 15075 }));
  });

  it('resposta assinada por outro par e recusada', async () => {
    const outro = generateKeyPairSync('ec', {
      namedCurve: 'P-521',
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });

    const strategy = buildAuthStrategy({ apiKey: 'k', privateKey });
    const request = prepared();
    await strategy.apply(request);

    await expect(
      AsymmetricJwtStrategy.verifyResponse(request.body!, outro.publicKey, 'ES512'),
    ).rejects.toThrow(/nao confere/);
  });
});
