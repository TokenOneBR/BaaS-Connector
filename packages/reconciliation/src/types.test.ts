import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { amountTolerance } from './types.js';

/** O menor inteiro que um `double` NAO representa: 2^53 + 1. */
const ALEM_DO_DOUBLE = 9_007_199_254_740_993n;

describe('tolerancia proporcional', () => {
  it('tem piso de um centavo, inclusive em zero e em valor negativo', () => {
    expect(amountTolerance(0n, 1n)).toBe(1n);
    expect(amountTolerance(-500n, 1n)).toBe(1n);
    expect(amountTolerance(500n, 0n)).toBe(1n);
  });

  it('arredonda para cima, nunca para baixo', () => {
    // 1 ponto-base de 10001 e 1,0001 centavo. Arredondar para baixo entregaria
    // uma tolerancia MENOR que a configurada.
    expect(amountTolerance(10_000n, 1n)).toBe(1n);
    expect(amountTolerance(10_001n, 1n)).toBe(2n);
    expect(amountTolerance(20_000n, 1n)).toBe(2n);
    expect(amountTolerance(20_001n, 1n)).toBe(3n);
  });

  it('e simetrica no sinal', () => {
    expect(amountTolerance(-1_000_000n, 5n)).toBe(amountTolerance(1_000_000n, 5n));
  });

  it('nao perde um centavo alem do alcance exato do double', () => {
    // 100% de tolerancia e o valor inteiro, ao centavo. Em ponto flutuante,
    // 2^53+1 vira 2^53 e a resposta sai um centavo menor — em SILENCIO.
    expect(amountTolerance(ALEM_DO_DOUBLE, 10_000n)).toBe(ALEM_DO_DOUBLE);
    // O double colapsa 2^53 e 2^53+1 no mesmo numero; o bigint nao.
    expect(Number(ALEM_DO_DOUBLE)).toBe(Number(ALEM_DO_DOUBLE - 1n));
    expect(amountTolerance(ALEM_DO_DOUBLE, 10_000n)).not.toBe(
      amountTolerance(ALEM_DO_DOUBLE - 1n, 10_000n),
    );
  });

  it('100% de tolerancia devolve exatamente o valor, para qualquer valor', () => {
    // A propriedade que mata qualquer implementacao em float: ela vale ate
    // 2^53 e passa a errar depois, que e exatamente onde ninguem testa a mao.
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 10n ** 24n }), (valor) => {
        expect(amountTolerance(valor, 10_000n)).toBe(valor);
      }),
      { numRuns: 500 },
    );
  });

  it('nunca devolve menos que a fracao pedida, para qualquer valor e taxa', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 24n }),
        fc.bigInt({ min: 1n, max: 10_000n }),
        (valor, bps) => {
          const tolerancia = amountTolerance(valor, bps);
          expect(tolerancia * 10_000n).toBeGreaterThanOrEqual(valor * bps);
          // E nunca mais que um centavo alem do necessario.
          expect((tolerancia - 1n) * 10_000n).toBeLessThan(valor * bps);
        },
      ),
      { numRuns: 500 },
    );
  });
});
