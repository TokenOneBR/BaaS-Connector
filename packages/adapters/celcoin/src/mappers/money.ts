import { Money, type MoneyJSON } from '@baasconn/taxonomy';

/**
 * A Celcoin manda dinheiro como NUMERO JSON (`"amount": 1500.75`).
 *
 * Isso e a pegadinha central deste adapter. `JSON.parse` ja converteu para
 * `double` antes de qualquer codigo nosso rodar, entao o dano de precisao,
 * quando existe, aconteceu na borda e nao ha o que fazer aqui. O que da para
 * fazer — e o que se faz — e converter para centavos com arredondamento
 * explicito e nunca deixar o `number` seguir para o dominio.
 *
 * `Math.round` sobre `valor * 100` e correto para os valores que o SPI aceita
 * (ate 2^53 centavos, muito acima de qualquer limite de PIX) e e o unico ponto
 * do adapter autorizado a ver um `number` de dinheiro.
 */
export function fromNumber(value: number): MoneyJSON {
  if (!Number.isFinite(value)) {
    throw new TypeError(`Valor monetario nao finito recebido da Celcoin: ${value}`);
  }
  return Money.of(BigInt(Math.round(value * 100))).toJSON();
}

export function optionalFromNumber(value: number | null | undefined): MoneyJSON | undefined {
  return value == null ? undefined : fromNumber(value);
}

/** Sentido inverso: o corpo de saida tambem usa numero. */
export function toNumber(value: MoneyJSON): number {
  return Number(Money.fromJSON(value).toDecimalString());
}
