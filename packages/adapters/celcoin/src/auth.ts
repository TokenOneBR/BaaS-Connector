import { OAuth2ClientCredentialsStrategy, type AuthStrategy } from '@baasconn/adapter-kit';
import type { ProviderContext, Token } from '@baasconn/provider-spi';

import type { CelcoinCredentials } from './credentials.js';
import { paths } from './endpoints.js';

interface CelcoinToken {
  access_token: string;
  token_type: string;
  expires_in: number;
}

/**
 * OAuth2 client_credentials com o segredo NO CORPO, form-encoded.
 *
 * A RFC 6749 permite Basic ou corpo; a Celcoin usa corpo, e mandar Basic para
 * quem espera corpo devolve 401 sem dizer por que. O kit ja modela a escolha
 * como `credentialPlacement`, entao ela fica declarada e nao implicita.
 *
 * `fetchToken` usa `fetch` direto, e nao o HttpClient do kit, porque o
 * HttpClient PRECISA de uma AuthStrategy para ser construido — passar por ele
 * aqui seria recursao. O TokenStore do kit ja coalesce chamadas concorrentes,
 * entao uma rajada de requisicoes com o token vencido busca um token so.
 */
export function buildAuthStrategy(
  ctx: ProviderContext,
  credentials: CelcoinCredentials,
): AuthStrategy {
  return new OAuth2ClientCredentialsStrategy({
    tokenUrl: `${ctx.baseUrl}${paths.token}`,
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    credentialPlacement: 'body',
    tokenStore: ctx.runtime.tokenStore,
    // O ambiente e a conexao entram na chave: duas conexoes do mesmo cliente
    // em ambientes diferentes NAO podem compartilhar token.
    cacheKey: `CELCOIN:${ctx.environment}:${ctx.connectionId}:${credentials.clientId}`,
    fetchToken: () => fetchToken(ctx, credentials),
  });
}

async function fetchToken(ctx: ProviderContext, credentials: CelcoinCredentials): Promise<Token> {
  const response = await fetch(`${ctx.baseUrl}${paths.token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    }).toString(),
    signal: ctx.signal,
  });

  if (!response.ok) {
    // Nao vaza o corpo: a resposta de uma rota de token pode ecoar a
    // credencial enviada, e ela nao pode aparecer em log nem em erro.
    throw new Error(`Falha ao obter token da Celcoin (HTTP ${response.status}).`);
  }

  const body = (await response.json()) as CelcoinToken;
  return {
    accessToken: body.access_token,
    expiresInSeconds: body.expires_in,
    tokenType: body.token_type,
  };
}
