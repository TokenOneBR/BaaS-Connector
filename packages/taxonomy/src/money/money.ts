import { type Rate } from './rate.js';
import { divideRounded, RoundingMode } from './rounding.js';

export type CurrencyCode = 'BRL';

/** Casas decimais por moeda. BRL usa centavos. */
export const CURRENCY_SCALE: Readonly<Record<CurrencyCode, number>> = Object.freeze({ BRL: 2 });

/**
 * Forma de dinheiro no wire.
 *
 * `amount` e a quantidade em unidades menores (centavos) como string, nunca um
 * decimal como "10.50". Um decimal convida `parseFloat` em todo consumidor
 * downstream; `{ amount: "1050", scale: 2 }` nao tem como ser mal usado.
 */
export interface MoneyJSON {
  readonly amount: string;
  readonly currency: CurrencyCode;
  readonly scale: number;
}

const MAX_SAFE_CENTS = 9_223_372_036_854_775_807n; // limite de BIGINT no Postgres

/**
 * Valor monetario em unidades menores inteiras.
 *
 * Escolha deliberada sobre decimal: a invariante central do ledger e
 * `soma dos lancamentos = 0`. Soma de inteiros e exata e associativa, o
 * Postgres agrega BIGINT muito mais rapido que NUMERIC, e a guarda de saldo
 * negativo vira um CHECK constraint em vez de logica de aplicacao.
 */
export class Money {
  private constructor(
    readonly cents: bigint,
    readonly currency: CurrencyCode,
  ) {}

  static of(cents: bigint | number, currency: CurrencyCode = 'BRL'): Money {
    const value = typeof cents === 'number' ? Money.fromNumber(cents) : cents;
    if (value > MAX_SAFE_CENTS || value < -MAX_SAFE_CENTS) {
      throw new RangeError(`Valor fora do intervalo de BIGINT: ${value}`);
    }
    return new Money(value, currency);
  }

  private static fromNumber(cents: number): bigint {
    if (!Number.isInteger(cents)) {
      throw new TypeError(
        `Money.of recebeu ${cents}: valores monetarios sao inteiros em unidades menores, nunca fracionarios.`,
      );
    }
    if (!Number.isSafeInteger(cents)) {
      throw new RangeError('Use bigint para valores acima de Number.MAX_SAFE_INTEGER');
    }
    return BigInt(cents);
  }

  static zero(currency: CurrencyCode = 'BRL'): Money {
    return new Money(0n, currency);
  }

  /**
   * Converte um decimal de provedor ("150.75") para centavos, exatamente.
   * Lanca se houver mais casas decimais do que a moeda comporta, em vez de
   * arredondar em silencio: perder um centavo aqui e um bug de conciliacao.
   */
  static fromDecimalString(value: string, currency: CurrencyCode = 'BRL'): Money {
    const scale = CURRENCY_SCALE[currency];
    const match = /^(-?)(\d+)(?:[.,](\d+))?$/.exec(value.trim());
    if (!match) {
      throw new RangeError(`Valor decimal invalido: ${JSON.stringify(value)}`);
    }
    const sign = match[1] === '-' ? -1n : 1n;
    const whole = match[2] ?? '0';
    const frac = match[3] ?? '';
    if (frac.length > scale) {
      throw new RangeError(
        `Valor ${JSON.stringify(value)} tem ${frac.length} casas decimais; ${currency} comporta ${scale}.`,
      );
    }
    const padded = frac.padEnd(scale, '0');
    return Money.of(BigInt(`${whole}${padded}`) * sign, currency);
  }

  /** Reconstroi a partir da forma de wire. */
  static fromJSON(json: MoneyJSON): Money {
    const expected = CURRENCY_SCALE[json.currency];
    if (json.scale !== expected) {
      throw new RangeError(
        `Escala ${json.scale} incompativel com ${json.currency} (esperado ${expected})`,
      );
    }
    return Money.of(BigInt(json.amount), json.currency);
  }

  /** Emite "150.75" para provedores que exigem decimais (Celcoin, BACEN). */
  toDecimalString(): string {
    const scale = CURRENCY_SCALE[this.currency];
    const negative = this.cents < 0n;
    const digits = (negative ? -this.cents : this.cents).toString().padStart(scale + 1, '0');
    const whole = digits.slice(0, digits.length - scale);
    const frac = digits.slice(digits.length - scale);
    return `${negative ? '-' : ''}${whole}${scale > 0 ? `.${frac}` : ''}`;
  }

  /** Formatacao pt-BR para exibicao. Consumidores nao devem parsear isto. */
  toDisplayString(): string {
    const [whole = '0', frac = ''] = this.toDecimalString().replace('-', '').split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const sign = this.cents < 0n ? '-' : '';
    return `${sign}R$ ${grouped}${frac ? `,${frac}` : ''}`;
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new TypeError(`Moedas incompativeis: ${this.currency} e ${other.currency}`);
    }
  }

  plus(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.cents + other.cents, this.currency);
  }

  minus(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.cents - other.cents, this.currency);
  }

  negate(): Money {
    return Money.of(-this.cents, this.currency);
  }

  abs(): Money {
    return this.cents < 0n ? this.negate() : this;
  }

  isNegative(): boolean {
    return this.cents < 0n;
  }

  isPositive(): boolean {
    return this.cents > 0n;
  }

  isZero(): boolean {
    return this.cents === 0n;
  }

  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    if (this.cents < other.cents) return -1;
    if (this.cents > other.cents) return 1;
    return 0;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.cents === other.cents;
  }

  /** Aplica uma taxa (tarifa, juros, desconto) com arredondamento explicito. */
  applyRate(rate: Rate, mode: RoundingMode = RoundingMode.HALF_EVEN): Money {
    return Money.of(
      divideRounded(this.cents * rate.numerator, rate.denominator, mode),
      this.currency,
    );
  }

  /**
   * Divide em `weights.length` partes sem residuo: `sum(allocate(w)) === this`.
   *
   * Metodo do maior resto: distribui o residuo um centavo por vez para as
   * partes com maior fracao pendente, desempatando por indice. E o que impede
   * o "centavo perdido" ao ratear uma tarifa entre lancamentos.
   */
  allocate(weights: readonly number[]): Money[] {
    if (weights.length === 0) {
      throw new RangeError('allocate exige ao menos um peso');
    }
    if (weights.some((w) => !Number.isFinite(w) || w < 0)) {
      throw new RangeError('Pesos devem ser finitos e nao negativos');
    }

    const scaled = weights.map((w) => BigInt(Math.round(w * 1_000_000)));
    const total = scaled.reduce((acc, w) => acc + w, 0n);
    if (total === 0n) {
      throw new RangeError('A soma dos pesos deve ser maior que zero');
    }

    const negative = this.cents < 0n;
    const abs = negative ? -this.cents : this.cents;

    const base = scaled.map((w) => (abs * w) / total);
    const remainders = scaled.map((w, i) => ({ index: i, rest: (abs * w) % total }));
    let leftover = abs - base.reduce((acc, v) => acc + v, 0n);

    remainders.sort((a, b) => (a.rest === b.rest ? a.index - b.index : a.rest > b.rest ? -1 : 1));
    for (const { index } of remainders) {
      if (leftover <= 0n) break;
      base[index] = (base[index] ?? 0n) + 1n;
      leftover -= 1n;
    }

    return base.map((v) => Money.of(negative ? -v : v, this.currency));
  }

  static sum(values: readonly Money[], currency: CurrencyCode = 'BRL'): Money {
    return values.reduce((acc, v) => acc.plus(v), Money.zero(currency));
  }

  toJSON(): MoneyJSON {
    return {
      amount: this.cents.toString(),
      currency: this.currency,
      scale: CURRENCY_SCALE[this.currency],
    };
  }

  toString(): string {
    return `${this.currency} ${this.toDecimalString()}`;
  }
}
