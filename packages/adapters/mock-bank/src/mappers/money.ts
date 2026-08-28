import { Money, type MoneyJSON } from '@baasconn/taxonomy';

/**
 * O Mock Bank fala dinheiro de DUAS formas.
 *
 * REST devolve decimal (`"1500.00"`); webhook devolve centavos como string
 * (`"150000"`). Confundir as duas produz um erro de fator 100 que passa em
 * revisao porque os dois valores parecem plausiveis — e por isso as duas
 * conversoes moram aqui, com nome que diz de onde o valor veio.
 */
export function fromDecimal(value: string): MoneyJSON {
  return Money.fromDecimalString(value).toJSON();
}

export function fromCents(value: string): MoneyJSON {
  return Money.of(BigInt(value)).toJSON();
}

/** Para o corpo da requisicao: o Mock Bank aceita decimal, como a Celcoin. */
export function toDecimal(value: MoneyJSON): string {
  return Money.fromJSON(value).toDecimalString();
}

export function optionalDecimal(value: string | null | undefined): MoneyJSON | undefined {
  return value == null ? undefined : fromDecimal(value);
}
