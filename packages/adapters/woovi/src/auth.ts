import { StaticApiKeyStrategy, type AuthStrategy } from '@baasconn/adapter-kit';

import type { WooviCredentials } from './credentials.js';

/**
 * `Authorization: <AppID>` — sem `Bearer`.
 *
 * A Woovi manda o AppID CRU no header. Adicionar o prefixo `Bearer`, que e o
 * reflexo de quem vem de OAuth2, devolve 401 sem explicacao. `prefix` fica
 * ausente de proposito, e este comentario existe para ninguem "consertar" isso.
 */
export function buildAuthStrategy(credentials: WooviCredentials): AuthStrategy {
  return new StaticApiKeyStrategy({ header: 'Authorization', value: credentials.appId });
}
