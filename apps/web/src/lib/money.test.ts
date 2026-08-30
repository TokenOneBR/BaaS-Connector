import { describe, expect, it } from 'vitest';

import { formatMoney, sumMoney } from './money';

const brl = (amount: string) => ({ amount, currency: 'BRL' as const, scale: 2 });

/**
 * `Intl` em pt-BR separa o simbolo com ESPACO NAO SEPARAVEL (U+00A0), nao com
 * espaco comum. Comparar com espaco comum falha de um jeito que parece um bug
 * de igualdade de string — as duas se veem identicas no relatorio. Normalizar
 * aqui e o que torna a assercao legivel.
 */
const normalizar = (valor: string) => valor.replace(/\u00a0/g, ' ');

describe('formatMoney', () => {
  it('formata em pt-BR', () => {
    expect(normalizar(formatMoney(brl('150075')))).toBe('R$ 1.500,75');
  });

  it('zero e negativo', () => {
    expect(formatMoney(brl('0'))).toContain('0,00');
    expect(formatMoney(brl('-2500'))).toContain('25,00');
    expect(formatMoney(brl('-2500')).startsWith('-')).toBe(true);
  });

  it('NAO perde precisao acima de 2^53', () => {
    // O valor vem como string porque JSON nao tem inteiro de 64 bits. Passar
    // por `Number` antes de dividir corrompe o resultado, e o sintoma aparece
    // so na conta grande — a que menos pode errar.
    const acima = '90071992547409910'; // 2^53 * 10, em centavos
    expect(normalizar(formatMoney(brl(acima)))).toContain('900.719.925.474.099,10');
  });

  it('nunca usa notacao compacta', () => {
    // `notation: 'compact'` diverge entre o ICU do Node e o do navegador em
    // algumas versoes, e o React acusa erro de hidratacao.
    const formatado = formatMoney(brl('1000000000'));
    expect(formatado).not.toContain('mi');
    expect(formatado).not.toContain('M');
  });

  it('soma em bigint', () => {
    expect(sumMoney([brl('100'), brl('250'), brl('-50')]).amount).toBe('300');
  });
});
