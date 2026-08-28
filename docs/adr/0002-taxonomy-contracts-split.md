# ADR 0002: Separar `taxonomy` de `contracts`

- **Status:** Aceito
- **Data:** 2026-08-28

## Contexto

O modelo canonico tem duas naturezas: o **vocabulario** (enums, codigos de
erro, validadores brasileiros, codec EMV) e a **forma do wire** (os DTOs que
a API publica expoe).

## Decisao

Dois pacotes. `@baasconn/taxonomy` sem dependencia alem de `ulid`;
`@baasconn/contracts` com Zod, dependendo de taxonomy.

## Alternativas consideradas

**Um pacote so (`canonical`).** Mais simples de navegar, mas junta coisas que
mudam em ritmos diferentes: adicionar um `OnboardingRejectionCode` e aditivo e
barato; mudar um DTO quebra a API publica e exige major. Juntos, todo bump de
enum forcaria os consumidores a reavaliar compatibilidade de DTO.

Alem disso, o Mock Bank e o motor de ledger precisam do vocabulario mas nao de
tipos com formato HTTP.

## Consequencias

Duas versoes para acompanhar. Em troca, `taxonomy` pode estabilizar em 1.0 e
ficar praticamente congelado enquanto `contracts` ainda itera.
