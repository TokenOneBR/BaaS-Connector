# ADR 0001: pnpm workspaces + Turborepo para o monorepo

- **Status:** Aceito
- **Data:** 2026-08-28

## Contexto

O projeto publica varios pacotes versionados independentemente e roda quatro
aplicacoes. Precisamos de ordenacao topologica de build e cache de CI. Como
projeto open source, o alvo principal e o PR de terceiro que so quer adicionar
um adapter.

## Decisao

pnpm workspaces + Turborepo. Escopo npm `@baasconn/*`.

## Alternativas consideradas

**Nx.** O valor e real (geradores, executores, regras de fronteira, cache),
mas impoe um segundo modelo mental sobre npm scripts. Um contribuidor externo
cujo objetivo inteiro e "adicionar um adapter da Woovi" teria que aprender
`project.json`, executores e versionamento de plugin Nx. Turborepo e um
orquestrador sobre scripts padrao: `pnpm --filter @baasconn/adapter-woovi test`
funciona com ou sem ele.

**pnpm puro.** Nao da ordenacao topologica nem cache. O grafo
taxonomy -> contracts -> spi -> adapter-kit -> adapters -> api precisa disso.

**npm ou yarn workspaces.** O `node_modules` estrito do pnpm e o que de fato
impoe as fronteiras entre pacotes: com hoisting, `apps/api` conseguiria
importar `undici` atraves de um adapter sem declarar a dependencia.

## Consequencias

Contribuidor precisa de corepack. As regras de fronteira ficam a cargo de
`eslint-plugin-import` e do pnpm estrito, nao de uma ferramenta dedicada.
