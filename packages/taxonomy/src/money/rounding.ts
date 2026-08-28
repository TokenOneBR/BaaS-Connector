/**
 * Modos de arredondamento.
 *
 * O padrao do projeto e HALF_EVEN (ABNT NBR 5891, "arredondamento bancario"):
 * HALF_UP introduz vies sistematico para cima que, somado sobre milhoes de
 * calculos de tarifa, vira dinheiro real.
 */
export enum RoundingMode {
  HALF_EVEN = 'HALF_EVEN',
  HALF_UP = 'HALF_UP',
  DOWN = 'DOWN',
  UP = 'UP',
}

/**
 * Divide `numerator` por `denominator` (inteiros) aplicando o modo.
 * `denominator` deve ser positivo. Simetrico em torno de zero.
 */
export function divideRounded(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (denominator <= 0n) {
    throw new RangeError('denominator deve ser positivo');
  }

  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const quotient = abs / denominator;
  const remainder = abs % denominator;

  let magnitude: bigint;
  if (remainder === 0n) {
    magnitude = quotient;
  } else {
    switch (mode) {
      case RoundingMode.DOWN:
        magnitude = quotient;
        break;
      case RoundingMode.UP:
        magnitude = quotient + 1n;
        break;
      case RoundingMode.HALF_UP:
        magnitude = remainder * 2n >= denominator ? quotient + 1n : quotient;
        break;
      case RoundingMode.HALF_EVEN: {
        const twice = remainder * 2n;
        if (twice > denominator) magnitude = quotient + 1n;
        else if (twice < denominator) magnitude = quotient;
        else magnitude = quotient % 2n === 0n ? quotient : quotient + 1n;
        break;
      }
    }
  }

  return negative ? -magnitude : magnitude;
}
