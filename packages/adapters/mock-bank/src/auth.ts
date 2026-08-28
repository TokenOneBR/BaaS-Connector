import type { AuthStrategy } from '@baasconn/adapter-kit';
import { OAuth2ClientCredentialsStrategy } from '@baasconn/adapter-kit';
import type { ProviderContext, Token } from '@baasconn/provider-spi';

import type { MockBankCredentials } from './credentials.js';
import type { MbToken } from './dto/index.js';

/**
 * OAuth2 client_credentials, como a Celcoin.
 *
 * O Mock Bank imita esse modelo de proposito: e o mais comum entre os BaaS
 * brasileiros, e um adapter que so soubesse lidar com header estatico daria a
 * falsa impressao de que o kit cobre o caso dificil.
 *
 * O `fetchToken` usa `fetch` direto, e nao o HttpClient do kit, porque o
 * HttpClient PRECISA de uma AuthStrategy para ser construido — passar por ele
 * aqui seria uma recursao. A rota de token e simples o bastante para isso nao
 * custar nada: sem retry cego, sem breaker, e o kit ja coalesce as chamadas
 * concorrentes no TokenStore.
 */
export function buildAuthStrategy(
  ctx: ProviderContext,
  credentials: MockBankCredentials,
): AuthStrategy {
  const cacheKey = `MOCK_BANK:${ctx.environment}:${ctx.connectionId}:${credentials.clientId}`;

  return new OAuth2ClientCredentialsStrategy({
    tokenUrl: `${ctx.baseUrl}/api/v1/auth/token`,
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    credentialPlacement: 'body',
    tokenStore: ctx.runtime.tokenStore,
    cacheKey,
    fetchToken: () => fetchToken(ctx, credentials),
  });
}

async function fetchToken(ctx: ProviderContext, credentials: MockBankCredentials): Promise<Token> {
  const response = await fetch(`${ctx.baseUrl}/api/v1/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    }),
    signal: ctx.signal,
  });

  if (!response.ok) {
    // Nao vaza o corpo: uma resposta de rota de token pode ecoar a credencial
    // enviada, e ela nao pode aparecer em log nem em mensagem de erro.
    throw new Error(`Falha ao obter token do Mock Bank (HTTP ${response.status}).`);
  }

  const body = (await response.json()) as MbToken;
  return {
    accessToken: body.access_token,
    expiresInSeconds: body.expires_in,
    tokenType: body.token_type,
  };
}
