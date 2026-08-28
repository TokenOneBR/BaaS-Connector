# ADR 0012: Changesets para versionamento e release

- **Status:** Aceito
- **Data:** 2026-08-28

## Contexto

O monorepo publica varios pacotes publicos versionados independentemente:
taxonomy, contracts, provider-spi, adapter-kit, ledger, sdk e seis adapters.

## Decisao

Changesets. Apps deployaveis sao `private: true`, versionados pela tag do
repositorio.

## Alternativas consideradas

**semantic-release.** E fundamentalmente single-package, e seus plugins de
monorepo sao frageis.

## A razao de verdade

Changesets faz o contribuidor **declarar a intencao no PR**: "isto e um minor
em `@baasconn/contracts`, e esta e a linha de changelog". Quando alguem mexe
no modelo canonico, essa declaracao e exatamente o sinal de revisao que o
mantenedor precisa — mais util que qualquer inferencia automatica a partir da
mensagem de commit.

## Consequencias

Um passo a mais no PR. O CI cobra changeset quando `packages/` muda, com
escape pela label `no-changeset`.

Publicacao por OIDC Trusted Publishing, com `--provenance`: nao existe
`NPM_TOKEN` de longa duracao.
