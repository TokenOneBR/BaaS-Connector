import { FixedClock, Clock } from '@baasconn/taxonomy';
import { Injectable } from '@nestjs/common';

/**
 * Relogio logico controlavel.
 *
 * Existe para os testes exercitarem a janela de 90 dias da devolucao Pix, a
 * expiracao de cobranca e o re-screening periodico sem `sleep`. `Date.now()` e
 * proibido por regra de lint em todo o repositorio.
 */
@Injectable()
export class MockClock implements Clock {
  private readonly inner = new FixedClock(new Date());
  private offsetSeconds = 0;
  private frozen = false;

  now(): Date {
    if (this.frozen) return this.inner.now();
    // Este e o unico lugar do repositorio onde Date.now() e legitimo: e a
    // implementacao do proprio relogio que todos os outros injetam.
    // eslint-disable-next-line no-restricted-syntax
    return new Date(Date.now() + this.offsetSeconds * 1000);
  }

  advanceSeconds(seconds: number): Date {
    if (this.frozen) return this.inner.advanceSeconds(seconds);
    this.offsetSeconds += seconds;
    return this.now();
  }

  /** Congela num instante fixo, para teste determinístico. */
  freezeAt(instant: Date): void {
    this.frozen = true;
    this.inner.set(instant);
  }

  unfreeze(): void {
    this.frozen = false;
  }

  reset(): void {
    this.offsetSeconds = 0;
    this.frozen = false;
  }
}
