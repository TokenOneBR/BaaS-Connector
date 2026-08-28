/**
 * Taxa/percentual como decimal exato.
 *
 * Nunca `number`: 0.1 + 0.2 !== 0.3 em ponto flutuante, e uma taxa aplicada a
 * milhoes de transacoes acumula o erro. Guardamos numerador inteiro e escala.
 */
export class Rate {
  private constructor(
    /** Numerador inteiro. `Rate.parse('2.5')` -> numerator 25n, scale 1. */
    readonly numerator: bigint,
    readonly scale: number,
  ) {}

  /** Aceita '2.5', '0.0075', '-1.25'. Ate 9 casas decimais. */
  static parse(value: string): Rate {
    const match = /^(-?)(\d+)(?:\.(\d{1,9}))?$/.exec(value.trim());
    if (!match) {
      throw new RangeError(`Rate invalida: ${JSON.stringify(value)}`);
    }
    const sign = match[1] ?? '';
    const whole = match[2] ?? '0';
    const frac = match[3] ?? '';
    const numerator = BigInt(`${whole}${frac}`) * (sign === '-' ? -1n : 1n);
    return new Rate(numerator, frac.length);
  }

  /** Constroi a partir de percentual: `Rate.percent('2.5')` representa 0.025. */
  static percent(value: string): Rate {
    const base = Rate.parse(value);
    return new Rate(base.numerator, base.scale + 2);
  }

  static zero(): Rate {
    return new Rate(0n, 0);
  }

  get denominator(): bigint {
    return 10n ** BigInt(this.scale);
  }

  isZero(): boolean {
    return this.numerator === 0n;
  }

  toString(): string {
    if (this.scale === 0) return this.numerator.toString();
    const negative = this.numerator < 0n;
    const digits = (negative ? -this.numerator : this.numerator)
      .toString()
      .padStart(this.scale + 1, '0');
    const whole = digits.slice(0, digits.length - this.scale);
    const frac = digits.slice(digits.length - this.scale);
    return `${negative ? '-' : ''}${whole}.${frac}`;
  }

  toJSON(): string {
    return this.toString();
  }
}
