import { OAuth2ClientCredentialsStrategy, type AuthStrategy } from '@baasconn/adapter-kit';
import type { ProviderContext, Token } from '@baasconn/provider-spi';

import type { DockCredentials } from './credentials.js';
import { paths } from './endpoints.js';

interface DockToken {
  access_token: string;
  token_type: string;
  expires_in: number;
}

/**
 * OAuth2 `client_credentials` com o segredo em Basic.
 *
 * Diferente da Celcoin, que usa o corpo. A RFC permite os dois, e mandar o
 * errado devolve 401 sem dizer por que — por isso a escolha e declarada em
 * `credentialPlacement` em vez de ficar implicita no `fetchToken`.
 */
export function buildAuthStrategy(
  ctx: ProviderContext,
  credentials: DockCredentials,
): AuthStrategy {
  return new OAuth2ClientCredentialsStrategy({
    tokenUrl: `${ctx.baseUrl}${paths.token}`,
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    scope: credentials.scope,
    credentialPlacement: 'basic',
    tokenStore: ctx.runtime.tokenStore,
    cacheKey: `DOCK:${ctx.environment}:${ctx.connectionId}:${credentials.clientId}`,
    fetchToken: () => fetchToken(ctx, credentials),
  });
}

async function fetchToken(ctx: ProviderContext, credentials: DockCredentials): Promise<Token> {
  const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString(
    'base64',
  );

  const response = await fetch(`${ctx.baseUrl}${paths.token}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      ...(credentials.scope ? { scope: credentials.scope } : {}),
    }).toString(),
    signal: ctx.signal,
  });

  if (!response.ok) {
    // Nao vaza o corpo: a resposta da rota de token pode ecoar a credencial.
    throw new Error(`Falha ao obter token da Dock (HTTP ${response.status}).`);
  }

  const body = (await response.json()) as DockToken;
  return {
    accessToken: body.access_token,
    expiresInSeconds: body.expires_in,
    tokenType: body.token_type,
  };
}
