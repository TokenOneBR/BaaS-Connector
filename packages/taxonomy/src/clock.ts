/**
 * Relogio injetavel.
 *
 * `Date.now()` direto e proibido por regra de lint: sem um relogio injetado,
 * testar a janela de 90 dias da devolucao Pix, expiracao de cobranca e
 * re-screening periodico exige `sleep`, que torna a suite lenta e instavel.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** Relogio controlado, para testes e para o Mock Bank. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current);
  }

  set(at: Date): void {
    this.current = new Date(at);
  }

  advanceSeconds(seconds: number): Date {
    this.current = new Date(this.current.getTime() + seconds * 1000);
    return this.now();
  }

  advanceDays(days: number): Date {
    return this.advanceSeconds(days * 86_400);
  }
}

export const SAO_PAULO_TIMEZONE = 'America/Sao_Paulo';

/**
 * Data contabil (yyyy-MM-dd) no fuso de Brasilia.
 *
 * O extrato e a conciliacao raciocinam em dia bancario brasileiro, nao em UTC:
 * um Pix as 22h de Brasilia e do mesmo dia util, mas ja e o dia seguinte em UTC.
 */
export function toEffectiveDate(instant: Date, timeZone = SAO_PAULO_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Diferenca em dias corridos entre duas datas. */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}
