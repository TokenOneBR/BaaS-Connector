import { InMemoryCircuitBreaker, InMemoryTokenStore } from '@baasconn/adapter-kit';
import { CassetteServer, type Cassette } from '@baasconn/adapter-kit/testing';
import type {
  ProviderAdapter,
  ProviderAdapterFactory,
  ProviderCallRecord,
  ProviderContext,
  ProviderCredentials,
  ScopedLogger,
} from '@baasconn/provider-spi';
import { Environment, FixedClock } from '@baasconn/taxonomy';

/**
 * Logger espiao.
 *
 * Captura tudo que o adapter registra durante a suite inteira, para a
 * assercao de redacao poder afirmar que nenhum documento ou credencial
 * apareceu em log.
 */
export class SpyLogger implements ScopedLogger {
  readonly lines: Array<{ level: string; payload: Record<string, unknown>; message?: string }> = [];

  private write(level: string, payload: Record<string, unknown>, message?: string): void {
    this.lines.push({ level, payload, message });
  }

  debug(payload: Record<string, unknown>, message?: string): void {
    this.write('debug', payload, message);
  }
  info(payload: Record<string, unknown>, message?: string): void {
    this.write('info', payload, message);
  }
  warn(payload: Record<string, unknown>, message?: string): void {
    this.write('warn', payload, message);
  }
  error(payload: Record<string, unknown>, message?: string): void {
    this.write('error', payload, message);
  }
  child(): ScopedLogger {
    return this;
  }

  /** Tudo que passou pelo logger, serializado, para varredura de vazamento. */
  dump(): string {
    return JSON.stringify(this.lines);
  }

  clear(): void {
    this.lines.length = 0;
  }
}

export interface Harness {
  server: CassetteServer;
  adapter: ProviderAdapter;
  context: ProviderContext;
  logger: SpyLogger;
  calls: ProviderCallRecord[];
  clock: FixedClock;
  stop(): Promise<void>;
}

/**
 * Monta um adapter apontado para um CassetteServer real.
 *
 * O servidor HTTP e de verdade de proposito: e o que faz o teste exercitar a
 * pilha HTTP do adapter, incluindo timeout, retry e reuso de conexao.
 */
export async function createHarness(options: {
  factory: ProviderAdapterFactory;
  credentials: ProviderCredentials;
  cassettes: readonly Cassette[];
  config?: Record<string, unknown>;
  buildContext?: (base: ProviderContext) => ProviderContext;
}): Promise<Harness> {
  const server = new CassetteServer({ cassettes: options.cassettes });
  const baseUrl = await server.start();

  const clock = new FixedClock(new Date('2026-08-28T12:00:00Z'));
  const logger = new SpyLogger();
  const calls: ProviderCallRecord[] = [];

  const base: ProviderContext = {
    connectionId: 'con_conformance',
    provider: options.factory.slug as never,
    environment: Environment.HOMOLOGACAO,
    baseUrl,
    credentials: options.credentials,
    config: options.config ?? {},
    correlationId: 'req_conformance',
    operationId: 'opr_conformance',
    actor: { type: 'SYSTEM', id: 'conformance' },
    logger,
    runtime: {
      tokenStore: new InMemoryTokenStore(clock),
      breaker: new InMemoryCircuitBreaker(clock),
      clock,
      recordCall: (record) => calls.push(record),
    },
  };

  const context = options.buildContext ? options.buildContext(base) : base;
  const adapter = options.factory.create(context);

  return {
    server,
    adapter,
    context,
    logger,
    calls,
    clock,
    stop: () => server.stop(),
  };
}

/**
 * Documentos e segredos que nunca podem aparecer em log ou em registro de
 * chamada. Sao os valores sinteticos usados pelas fixtures.
 */
export const LEAK_CANARIES: readonly string[] = Object.freeze([
  '52998224725',
  '529.982.247-25',
  '11222333000181',
  '11.222.333/0001-81',
  'super-secret-client-secret',
  'conformance-api-key-value',
]);

export function findLeaks(haystack: string, canaries: readonly string[] = LEAK_CANARIES): string[] {
  return canaries.filter((canary) => haystack.includes(canary));
}
