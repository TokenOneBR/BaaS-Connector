import type { MoneyJSON } from '@baasconn/taxonomy';

/**
 * Formata dinheiro a partir de `bigint`, sempre.
 *
 * Duas armadilhas fechadas aqui, e as duas ja custaram caro em outros
 * projetos:
 *
 * 1. O valor vem como STRING no wire (`{ amount: "150075" }`) porque JSON nao
 *    tem inteiro de 64 bits. Passar por `Number` perde precisao acima de 2^53,
 *    e o sintoma aparece so em conta grande — a que menos pode errar.
 *
 * 2. `notation: 'compact'` do `Intl` produz saida diferente entre o Node do
 *    servidor e o motor do navegador em algumas versoes de ICU, e o React
 *    acusa erro de hidratacao. Nunca usamos.
 */
const FORMATADOR = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(money: MoneyJSON): string {
  const cents = BigInt(money.amount);
  const negativo = cents < 0n;
  const absoluto = negativo ? -cents : cents;

  const divisor = 10n ** BigInt(money.scale);
  const inteiro = absoluto / divisor;
  const resto = absoluto % divisor;

  // A divisao e em `bigint` e so o resultado final vira `number`, ja pequeno.
  // Converter antes de dividir e o erro que corrompe valores grandes.
  const valor = Number(inteiro) + Number(resto) / Number(divisor);
  return FORMATADOR.format(negativo ? -valor : valor);
}

/** Soma para totais de tela. `bigint` de ponta a ponta. */
export function sumMoney(values: readonly MoneyJSON[]): MoneyJSON {
  const total = values.reduce((acumulado, money) => acumulado + BigInt(money.amount), 0n);
  return { amount: total.toString(), currency: values[0]?.currency ?? 'BRL', scale: 2 };
}
