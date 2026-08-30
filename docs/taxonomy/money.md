# Dinheiro

`bigint` em unidades menores (centavos), em toda parte. `BIGINT` no Postgres.
Nunca `number`, nunca `float`, nunca `parseFloat`.

## No wire

Objeto auto-descritivo, e não um número solto:

```json
{ "amount": "1050", "currency": "BRL", "scale": 2 }
```

`amount` é **string** porque `JSON.parse` de `1050` dá um `number`, e o
primeiro `JSON.parse` de um valor grande num cliente qualquer perderia
precisão em silêncio. `scale` viaja junto porque nem toda moeda tem duas casas
— e porque um campo chamado `amount` sem escala convida a quem lê a assumir
reais.

Uma regra de lint proíbe `number` em campos `*Cents`, `*Amount` e `*Balance`.

## Decimal só na fronteira

`Money.toDecimalString()` existe **exclusivamente** para provedores que exigem
decimal na requisição — Celcoin e o próprio BACEN, entre outros. Ele vive no
adapter, nunca no domínio. `Money.fromDecimalString()` faz o caminho inverso
na resposta.

O Mock Bank imita essa ambiguidade de propósito: a REST devolve decimal
(`"1500.00"`) e o webhook devolve centavos como string (`"150000"`). Um
provedor real fazendo isso é comum, e um adapter que trata os dois iguais erra
por um fator de cem.

## Arredondamento

Acontece em exatamente dois lugares:

| Operação | Regra |
|---|---|
| `Money.applyRate` | `HALF_EVEN` (ABNT NBR 5891) |
| `Money.allocate` | Resto distribuído; `sum(parts) === original` |

`HALF_EVEN` e não `HALF_UP` porque arredondar sempre para cima enviesa o
somatório de milhares de operações na mesma direção. `allocate` garante por
*property test* que a soma das partes é exatamente o valor original — dividir
R$ 10,00 em três e devolver R$ 9,99 é o clássico centavo que some.

## Tolerância na conciliação

A tolerância proporcional do passe fuzzy é `bigint` puro. `amount * 0.0001` em
ponto flutuante perde precisão acima de ~9·10¹³ centavos, e a tolerância
cresceria em silêncio — casamentos errados exatamente nos valores que mais
importam. Há *property test* em torno de 2⁵³ para provar isso.
