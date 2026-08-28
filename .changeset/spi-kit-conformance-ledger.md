---
"@baasconn/provider-spi": minor
"@baasconn/adapter-kit": minor
"@baasconn/conformance": minor
"@baasconn/ledger": minor
---

SPI de provedores, ferramentaria de adapter, suite de conformidade e motor de
ledger de partidas dobradas.

O SPI e facetado com manifesto de capacidades: faceta ausente e um fato
verificavel, enquanto stub que lanca excecao e indistinguivel de "suportado".
A validacao de boot recusa manifesto que promete capacidade sem a faceta, e
recusa provedor sem idempotencia que nao implemente busca pela nossa chave.

O kit carrega a regra que impede pagamento duplo: escrita nao idempotente cuja
falha nao e provadamente pre-commit vira ProviderOutcomeUnknownError, nunca
retry.

O ledger e em duas fases, com guarda de saldo negativo e ordem deterministica
de lock.
