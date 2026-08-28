import { buildErrorMapper, HttpClient } from '@baasconn/adapter-kit';
import type { ProviderContext } from '@baasconn/provider-spi';

import { buildAuthStrategy } from './auth.js';
import type { MockBankCredentials } from './credentials.js';
import { errorMappings } from './errors.js';
import { redaction } from './redaction.js';

/**
 * Monta o cliente HTTP da conexao.
 *
 * Tudo que o adapter ganha de graca — retry com jitter, breaker por
 * provedor x ambiente x classe de endpoint, redacao, registro da chamada,
 * conversao de desfecho indeterminado em ProviderOutcomeUnknownError — vem
 * dessa construcao. O adapter nao chama `fetch` em lugar nenhum a nao ser na
 * rota de token, que precisa existir antes do proprio cliente.
 */
export function buildClient(ctx: ProviderContext, credentials: MockBankCredentials): HttpClient {
  return new HttpClient({
    baseUrl: ctx.baseUrl,
    providerSlug: 'MOCK_BANK',
    environment: ctx.environment,
    connectionId: ctx.connectionId,
    auth: buildAuthStrategy(ctx, credentials),
    errorMapper: buildErrorMapper(errorMappings),
    clock: ctx.runtime.clock,
    breaker: ctx.runtime.breaker,
    redaction,
    correlationId: ctx.correlationId,
    operationId: ctx.operationId,
    signal: ctx.signal,
    onCall: (record) => ctx.runtime.recordCall(record),
  });
}
