import { buildErrorMapper, HttpClient, type HttpClientOptions } from '@baasconn/adapter-kit';
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
    // Os timeouts padrao esperam 10s por cabecalhos. O cenario de desfecho
    // desconhecido do Mock Bank simplesmente NAO responde, entao uma suite que
    // o exercita pagaria 10s por teste. A conexao pode encurta-los — e so este
    // adapter aceita isso, porque so ele tem um cenario que trava de proposito.
    timeouts: timeoutOverride(ctx.config),
    correlationId: ctx.correlationId,
    operationId: ctx.operationId,
    signal: ctx.signal,
    onCall: (record) => ctx.runtime.recordCall(record),
  });
}

function timeoutOverride(config: Readonly<Record<string, unknown>>): HttpClientOptions['timeouts'] {
  const ms = Number(config.requestTimeoutMs);
  if (!Number.isFinite(ms) || ms <= 0) return undefined;

  const timeouts = { connectMs: ms, headersMs: ms, bodyMs: ms, totalMs: ms };
  return { read: timeouts, write: timeouts, auth: timeouts, upload: timeouts };
}
