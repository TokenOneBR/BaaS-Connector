import type { Prisma } from '@baasconn/db';
import { Metrics } from '@baasconn/observability';
import type { ProviderCallRecord } from '@baasconn/provider-spi';
import { newId } from '@baasconn/taxonomy';
import type { Environment } from '@baasconn/taxonomy';
import { Injectable, Logger } from '@nestjs/common';

import type { ProviderCallSink } from '../providers/provider.resolver.js';

import { PrismaService } from './prisma.service.js';

/**
 * Trilha de chamadas ao provedor.
 *
 * Nao bloqueia a resposta: o `record()` do SPI e sincrono de proposito, e a
 * gravacao segue em background. Falhar em gravar a trilha nunca pode derrubar
 * uma transferencia que ja foi aceita pelo provedor — o valor da trilha e para
 * o suporte depois, nao para o cliente agora.
 *
 * O corpo ja chega redigido do adapter-kit: nenhum payload cru passa por aqui.
 */
@Injectable()
export class ProviderCallRecorder implements ProviderCallSink {
  private readonly logger = new Logger(ProviderCallRecorder.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: Metrics,
  ) {}

  record(call: ProviderCallRecord): void {
    const capability = call.capability ?? `endpoint.${call.endpointClass}`;

    this.metrics.providerRequests.inc({
      provider: call.provider,
      capability,
      http_status: String(call.status ?? 0),
      error_code: call.canonicalErrorCode ?? '',
    });
    this.metrics.providerRequestDuration.observe(
      {
        provider: call.provider,
        capability,
        environment: call.environment,
        outcome: call.outcome,
      },
      call.durationMs / 1000,
    );
    if (call.attempts > 1) {
      this.metrics.providerRetries.inc(
        { provider: call.provider, capability, reason: call.outcome },
        call.attempts - 1,
      );
    }
    if (call.status === 429) {
      this.metrics.providerRateLimited.inc({ provider: call.provider });
    }

    void this.persist(call).catch((error: unknown) => {
      this.logger.warn({ err: error, provider: call.provider }, 'Falha ao gravar provider_call');
    });
  }

  private async persist(call: ProviderCallRecord): Promise<void> {
    await this.prisma.client.providerCall.create({
      data: {
        id: newId('providerCall'),
        environment: call.environment as Environment,
        connectionId: call.connectionId,
        provider: call.provider,
        correlationId: call.correlationId,
        operationId: call.operationId ?? null,
        method: call.method,
        path: call.path.slice(0, 512),
        endpointClass: call.endpointClass,
        requestHeaders: call.requestHeaders as Prisma.InputJsonValue,
        requestBody: (call.requestBody ?? null) as Prisma.InputJsonValue,
        responseStatus: call.status ?? null,
        responseBody: (call.responseBody ?? null) as Prisma.InputJsonValue,
        providerRequestId: call.providerRequestId ?? null,
        durationMs: Math.round(call.durationMs),
        attempts: call.attempts,
        outcome: call.outcome,
        canonicalErrorCode: call.canonicalErrorCode ?? null,
      },
    });
  }
}

/** Sink inerte: usado quando a API sobe sem banco (teste, `--dry-run`). */
export class NoopProviderCallSink implements ProviderCallSink {
  record(): void {
    // sem efeito
  }
}
