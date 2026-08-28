import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { Money } from './money.js';
import { Rate } from './rate.js';
import { divideRounded, RoundingMode } from './rounding.js';

describe('Money', () => {
  it('rejeita numeros fracionarios, porque centavo nao tem metade', () => {
    expect(() => Money.of(10.5)).toThrow(/inteiros em unidades menores/);
  });

  it('faz round-trip por decimal string sem perder centavos', () => {
    const money = Money.fromDecimalString('150.75');
    expect(money.cents).toBe(15075n);
    expect(money.toDecimalString()).toBe('150.75');
  });

  it('aceita virgula como separador decimal, que aparece em payload brasileiro', () => {
    expect(Money.fromDecimalString('1500,00').cents).toBe(150000n);
  });

  it('recusa mais casas decimais do que a moeda comporta em vez de arredondar', () => {
    expect(() => Money.fromDecimalString('10.123')).toThrow(/3 casas decimais/);
  });

  it('preserva o sinal em valores negativos', () => {
    const money = Money.fromDecimalString('-0.01');
    expect(money.cents).toBe(-1n);
    expect(money.toDecimalString()).toBe('-0.01');
    expect(money.isNegative()).toBe(true);
  });

  it('serializa em unidades menores auto-descritivas, nunca em decimal', () => {
    expect(Money.of(1050n).toJSON()).toEqual({ amount: '1050', currency: 'BRL', scale: 2 });
  });

  it('reconstroi a partir do JSON', () => {
    const original = Money.of(-98_765n);
    expect(Money.fromJSON(original.toJSON()).equals(original)).toBe(true);
  });

  it('recusa somar moedas diferentes', () => {
    const brl = Money.of(100n, 'BRL');
    const other = Money.of(100n, 'USD' as 'BRL');
    expect(() => brl.plus(other)).toThrow(/Moedas incompativeis/);
  });

  it('formata para exibicao em pt-BR com separador de milhar', () => {
    expect(Money.of(123_456_789n).toDisplayString()).toBe('R$ 1.234.567,89');
    expect(Money.of(-50n).toDisplayString()).toBe('-R$ 0,50');
  });

  it('aplica taxa arredondando para baixo quando o resto nao e empate', () => {
    // 2,5% de R$ 10,10 = 25,25 centavos: nao ha empate, os dois modos dao 25.
    expect(Money.of(1010n).applyRate(Rate.percent('2.5')).cents).toBe(25n);
    expect(Money.of(1010n).applyRate(Rate.percent('2.5'), RoundingMode.HALF_UP).cents).toBe(25n);
  });

  it('usa arredondamento bancario no empate, e e ai que os modos divergem', () => {
    // 2,5% de R$ 0,20 = exatamente 0,5 centavo. HALF_EVEN vai para o par (0).
    expect(Money.of(20n).applyRate(Rate.percent('2.5')).cents).toBe(0n);
    expect(Money.of(20n).applyRate(Rate.percent('2.5'), RoundingMode.HALF_UP).cents).toBe(1n);

    // 2,5% de R$ 1,00 = exatamente 2,5 centavos. O par mais proximo e 2.
    expect(Money.of(100n).applyRate(Rate.percent('2.5')).cents).toBe(2n);
    expect(Money.of(100n).applyRate(Rate.percent('2.5'), RoundingMode.HALF_UP).cents).toBe(3n);
  });

  it('nao acumula vies para cima ao aplicar a mesma taxa muitas vezes', () => {
    // A razao de o padrao ser HALF_EVEN: sobre muitos empates, HALF_UP sempre
    // sobe e o excedente vira dinheiro real.
    const rate = Rate.percent('2.5');
    let halfEven = 0n;
    let halfUp = 0n;
    for (let i = 1; i <= 200; i++) {
      const amount = Money.of(BigInt(i) * 20n);
      halfEven += amount.applyRate(rate).cents;
      halfUp += amount.applyRate(rate, RoundingMode.HALF_UP).cents;
    }
    expect(halfUp).toBeGreaterThan(halfEven);
  });

  describe('allocate', () => {
    it('distribui o resto sem perder centavo', () => {
      const parts = Money.of(100n).allocate([1, 1, 1]);
      expect(parts.map((p) => p.cents)).toEqual([34n, 33n, 33n]);
    });

    it('respeita pesos desiguais', () => {
      const parts = Money.of(1000n).allocate([70, 30]);
      expect(parts.map((p) => p.cents)).toEqual([700n, 300n]);
    });

    it('preserva o sinal', () => {
      const parts = Money.of(-100n).allocate([1, 1, 1]);
      expect(parts.map((p) => p.cents)).toEqual([-34n, -33n, -33n]);
      expect(Money.sum(parts).cents).toBe(-100n);
    });

    it('recusa pesos que somam zero', () => {
      expect(() => Money.of(100n).allocate([0, 0])).toThrow(/maior que zero/);
    });

    it('a soma das partes sempre reconstitui o total (property)', () => {
      fc.assert(
        fc.property(
          fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }),
          fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 1, maxLength: 12 }),
          (cents, weights) => {
            fc.pre(weights.reduce((a, b) => a + b, 0) > 0);
            const parts = Money.of(cents).allocate(weights);
            expect(Money.sum(parts).cents).toBe(cents);
            expect(parts).toHaveLength(weights.length);
          },
        ),
        { numRuns: 300 },
      );
    });
  });

  it('round-trip decimal preserva o valor exato (property)', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 14n), max: 10n ** 14n }), (cents) => {
        const money = Money.of(cents);
        expect(Money.fromDecimalString(money.toDecimalString()).cents).toBe(cents);
      }),
      { numRuns: 300 },
    );
  });
});

describe('divideRounded', () => {
  it('HALF_EVEN desempata para o par nos dois sentidos', () => {
    expect(divideRounded(5n, 2n, RoundingMode.HALF_EVEN)).toBe(2n);
    expect(divideRounded(7n, 2n, RoundingMode.HALF_EVEN)).toBe(4n);
  });

  it('e simetrico em torno de zero', () => {
    for (const mode of Object.values(RoundingMode)) {
      expect(divideRounded(-7n, 2n, mode)).toBe(-divideRounded(7n, 2n, mode));
    }
  });

  it('DOWN trunca e UP sempre sobe quando ha resto', () => {
    expect(divideRounded(9n, 2n, RoundingMode.DOWN)).toBe(4n);
    expect(divideRounded(9n, 2n, RoundingMode.UP)).toBe(5n);
    expect(divideRounded(8n, 2n, RoundingMode.UP)).toBe(4n);
  });

  it('recusa denominador nao positivo', () => {
    expect(() => divideRounded(1n, 0n, RoundingMode.HALF_EVEN)).toThrow(/positivo/);
  });
});

describe('Rate', () => {
  it('parseia e reserializa preservando a escala', () => {
    expect(Rate.parse('0.0075').toString()).toBe('0.0075');
    expect(Rate.parse('-1.25').toString()).toBe('-1.25');
    expect(Rate.parse('3').toString()).toBe('3');
  });

  it('percent desloca a escala em duas casas', () => {
    const rate = Rate.percent('2.5');
    expect(rate.numerator).toBe(25n);
    expect(rate.denominator).toBe(1000n);
  });

  it('recusa entrada malformada', () => {
    expect(() => Rate.parse('abc')).toThrow(/Rate invalida/);
  });
});
