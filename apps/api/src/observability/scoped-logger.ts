import { contextBindings } from '@baasconn/observability';
import type { ScopedLogger } from '@baasconn/provider-spi';
import type { Logger } from 'pino';

/**
 * Ponte entre o pino e o `ScopedLogger` do SPI.
 *
 * O adapter nao importa o logger do core — recebe esta interface minima pelo
 * `ProviderContext`. E o que permite um adapter viver num pacote separado sem
 * arrastar `pino`, `@nestjs/*` nem a configuracao do conector junto.
 *
 * Cada linha carrega o contexto de requisicao (`requestId`, `correlationId`,
 * `environment`) lido do AsyncLocalStorage no momento da escrita, e nao no da
 * criacao: o mesmo logger singleton serve requisicoes diferentes.
 */
export class PinoScopedLogger implements ScopedLogger {
  constructor(
    private readonly logger: Logger,
    private readonly bindings: Record<string, unknown> = {},
  ) {}

  debug(payload: Record<string, unknown>, message?: string): void {
    this.logger.debug(this.merge(payload), message);
  }

  info(payload: Record<string, unknown>, message?: string): void {
    this.logger.info(this.merge(payload), message);
  }

  warn(payload: Record<string, unknown>, message?: string): void {
    this.logger.warn(this.merge(payload), message);
  }

  error(payload: Record<string, unknown>, message?: string): void {
    this.logger.error(this.merge(payload), message);
  }

  child(bindings: Record<string, unknown>): ScopedLogger {
    return new PinoScopedLogger(this.logger, { ...this.bindings, ...bindings });
  }

  private merge(payload: Record<string, unknown>): Record<string, unknown> {
    return { ...contextBindings(), ...this.bindings, ...payload };
  }
}
