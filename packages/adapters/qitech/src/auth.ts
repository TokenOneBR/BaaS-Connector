import {
  AsymmetricJwtStrategy,
  CompositeStrategy,
  StaticApiKeyStrategy,
} from '@baasconn/adapter-kit';
import type { AuthStrategy } from '@baasconn/adapter-kit';

import type { QiTechCredentials } from './credentials.js';

/**
 * API key identifica; a assinatura ECDSA autentica.
 *
 * As duas coisas juntas, via `CompositeStrategy`. A `apiKey` diz QUEM esta
 * chamando; o JWS assinado com ES512 prova que a requisicao nao foi alterada
 * no caminho. Uma sem a outra nao serve: a chave sozinha e um segredo
 * compartilhado que qualquer intermediario que a veja pode reusar.
 *
 * O corpo enviado E o proprio JWS (`replaceBody`), que e como a QI Tech
 * modela: o payload assinado substitui o JSON, e o `content-type` muda.
 */
export function buildAuthStrategy(credentials: QiTechCredentials): AuthStrategy {
  const identity = new StaticApiKeyStrategy({
    header: 'API-CLIENT-KEY',
    value: credentials.apiKey,
  });

  if (!credentials.privateKey) return identity;

  const signature = new AsymmetricJwtStrategy({
    // ECDSA com SHA-512. NAO e HMAC: nao existe segredo compartilhado aqui, e
    // o kit so ganhou esta estrategia por causa deste provedor.
    algorithm: 'ES512',
    privateKey: credentials.privateKey,
    keyId: credentials.keyId,
    claims: (request) => ({
      sub: credentials.apiKey,
      method: request.method,
      path: request.path,
      ...(request.body ? { body: JSON.parse(request.body) as unknown } : {}),
    }),
    headers: () => ({ 'content-type': 'application/jwt' }),
    replaceBody: true,
  });

  return new CompositeStrategy([identity, signature]);
}
