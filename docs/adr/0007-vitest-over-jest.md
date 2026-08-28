# ADR 0007: Vitest em todo o repositorio, inclusive NestJS

- **Status:** Aceito
- **Data:** 2026-08-28

## Contexto

Precisamos de test runner para pacotes puros, tres apps NestJS e um app React.

## Decisao

Vitest em toda parte. Para os projetos NestJS, via `unplugin-swc`.

## A pegadinha que decide

Apenas o SWC emite `emitDecoratorMetadata`. O esbuild sozinho **nao** emite, e
sem esse metadado o container de DI do Nest nao resolve dependencia por tipo.
Quem tenta Vitest com NestJS e desiste normalmente tropeca nisso.

## Alternativas consideradas

**Jest para backend, Vitest para frontend.** Duas configuracoes, duas APIs de
mock, dois relatorios de cobertura para mesclar, e uma pergunta do contribuidor
em todo PR. Para um projeto open source, um runner so e materialmente melhor.

**ts-jest.** Cerca de 3 a 5 vezes mais lento num repositorio deste formato, e o
watch e um loop interno pior para quem esta iterando em mapper de adapter.

## Consequencias

`unplugin-swc` e uma dependencia a mais no caminho de teste. Em troca,
`vitest.workspace.ts` da um comando so e uma cobertura mesclada.
