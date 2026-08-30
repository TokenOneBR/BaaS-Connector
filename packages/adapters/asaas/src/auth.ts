import { StaticApiKeyStrategy, type AuthStrategy } from '@baasconn/adapter-kit';

import type { AsaasCredentials } from './credentials.js';

/**
 * `access_token: <chave>` — header proprio, sem `Bearer`.
 *
 * A base de redacao do kit ja mascara `asaas-access-token`; este header
 * (`access_token`, sem prefixo) e o de SAIDA e entra na redacao deste adapter.
 */
export function buildAuthStrategy(credentials: AsaasCredentials): AuthStrategy {
  return new StaticApiKeyStrategy({ header: 'access_token', value: credentials.apiKey });
}
