import { createHash } from 'node:crypto';

import { Metrics } from '@baasconn/observability';
import { BaasError, BaasErrorCode, newId, type Clock } from '@baasconn/taxonomy';
import { Controller, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import type { Response } from 'express';

import { Public, type AuthedRequest } from '../auth/api-key.guard.js';
import { CLOCK } from '../common/clock.js';
import { EVENT_QUEUE, type EventQueue } from '../events/outbox.types.js';
import { CredentialResolver } from '../providers/credential.resolver.js';
import { ProviderResolver } from '../providers/provider.resolver.js';

import { INBOUND_EVENT_REPOSITORY, type InboundEventRepository } from './webhooks.types.js';

/**
 * Recepcao de webhook.
 *
 * FORA do `/v1` de proposito: URLs de callback sao registradas uma vez no
 * provedor e precisam sobreviver ao versionamento da nossa API. Trocar
 * `/v1` por `/v2` nao pode exigir reconfigurar cada BaaS.
 *
 * A conexao vai no caminho, e nao so o slug do provedor: com uma conexao por
 * ambiente por provedor, o slug sozinho nao distingue homologacao de producao,
 * e adivinhar pelo payload e fragil. A URL e registrada uma vez, entao
 * carregar o `connectionId` nela nao custa nada.
 *
 * O handler NAO parseia nem mapeia. Ele verifica, deduplica, persiste,
 * enfileira e responde — alvo p99 abaixo de 50 ms. Um bug de mapeamento nunca
 * pode fazer o provedor ver 500 e comecar a fazer backoff no nosso endpoint,
 * porque ai perdemos TODOS os eventos, inclusive os que sabemos tratar.
 */
@Controller('webhooks')
@Public()
export class WebhooksController {
  constructor(
    private readonly providers: ProviderResolver,
    private readonly credentials: CredentialResolver,
    private readonly metrics: Metrics,
    @Inject(INBOUND_EVENT_REPOSITORY) private readonly events: InboundEventRepository,
    @Inject(EVENT_QUEUE) private readonly queue: EventQueue,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Post(':provider/:connectionId')
  @HttpCode(200)
  async receive(
    @Param('provider') provider: string,
    @Param('connectionId') connectionId: string,
    @Req() request: AuthedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const rawBody = request.rawBody ?? Buffer.alloc(0);
    const receivedAt = this.clock.now();

    const bound = await this.providers.resolve(connectionId);
    if (bound.slug.toLowerCase() !== provider.toLowerCase()) {
      throw new BaasError(BaasErrorCode.CONNECTION_NOT_FOUND, {
        message: `A conexao ${connectionId} nao pertence ao provedor ${provider}.`,
      });
    }
    if (!bound.adapter.webhooks) {
      throw new BaasError(BaasErrorCode.CAPABILITY_NOT_SUPPORTED, {
        message: `O provedor ${bound.slug} nao recebe webhooks.`,
      });
    }

    const secret = await this.credentials.webhookSecret(connectionId);
    if (!secret) {
      throw new BaasError(BaasErrorCode.PROVIDER_CREDENTIALS_INVALID, {
        message: `A conexao ${connectionId} nao tem segredo de webhook configurado.`,
      });
    }

    const raw = {
      rawBody,
      headers: request.headers as Record<string, string | string[] | undefined>,
      query: request.query as Record<string, string>,
      receivedAt,
    };

    try {
      bound.adapter.webhooks.verifySignature(raw, { value: secret });
    } catch (error) {
      // Um pico aqui e evento de SEGURANCA, nao bug: alguem esta tentando
      // injetar evento, ou o segredo foi rotacionado so de um lado.
      this.metrics.webhookSignatureFailures.inc({ provider: bound.slug });
      throw error;
    }

    const identity = bound.adapter.webhooks.eventIdentity(raw);

    const claim = await this.events.claim({
      id: newId('inboundEvent'),
      environment: bound.context.environment,
      connectionId,
      provider: bound.slug,
      dedupeKey: identity.providerEventId,
      providerEventId: identity.providerEventId,
      eventTypeRaw: headerValue(request.headers['x-mockbank-event-type']),
      occurredAt: identity.occurredAt ? new Date(identity.occurredAt) : null,
      receivedAt,
      headers: safeHeaders(request.headers),
      payload: rawBody,
      rawSha256: createHash('sha256').update(rawBody).digest('hex'),
      signatureValid: true,
      status: 'RECEIVED',
      attempts: 0,
    });

    if (!claim.inserted) {
      // Reentrega e comportamento NORMAL do provedor, nao erro. Respondemos
      // 200 para ele parar de tentar, e nao refazemos o trabalho.
      this.metrics.webhookDuplicates.inc({ provider: bound.slug });
      response.setHeader('X-Baas-Duplicate', 'true');
      return bound.adapter.webhooks.ackResponse?.().body ?? { received: true };
    }

    // Persistido ANTES de enfileirar: perda de fila custa latencia (o varredor
    // reenfileira), perda de banco custaria o evento.
    await this.queue.enqueue({ kind: 'inbound_webhook', eventId: claim.record.id });

    return bound.adapter.webhooks.ackResponse?.().body ?? { received: true };
  }
}

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Guarda os cabecalhos sem os que podem carregar credencial. */
function safeHeaders(headers: Record<string, string | string[] | undefined>) {
  const dropped = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key']);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (dropped.has(key.toLowerCase())) continue;
    out[key] = Array.isArray(value) ? value.join(', ') : (value ?? '');
  }
  return out;
}
