# ADR 0003: SPI facetado com manifesto de capacidades

- **Status:** Aceito
- **Data:** 2026-08-28

## Contexto

Provedores de BaaS cobrem subconjuntos muito diferentes da funcionalidade. A
Woovi e centrada em cobranca e nao abre subconta PJ; a QI Tech faz onboarding
completo. O core precisa responder "este provedor suporta KYB?" **antes** de
qualquer chamada de rede.

## Decisao

O adapter raiz e fino: identidade, manifesto e facetas opcionais
(`accounts`, `onboarding`, `balance`, `pixKeys`, `pixCharges`,
`pixTransfers`, `statement`, `webhooks`). O manifesto e a fonte da verdade
sobre suporte, com `SUPPORTED | EMULATED | PARTIAL | UNSUPPORTED` e
restricoes legiveis por maquina.

Faceta presente cujo manifesto diz `UNSUPPORTED` e erro de validacao **no
boot**.

## Alternativas consideradas

**Uma interface com 30 metodos.** Forca todo adapter a implementar tudo com
stub, e "suportado" fica indistinguivel de "lanca excecao". O modo de falha
resultante — capacidade declarada mas quebrada — e exatamente o que a suite de
conformidade existe para matar.

**Detectar capacidade em runtime pela ausencia do metodo.** Nao permite
declarar `PARTIAL` com nota, nem restricoes que o core valida antes de chamar.

## Consequencias

O manifesto precisa ser mantido honesto — a suite de conformidade cobra isso
mecanicamente, nos dois sentidos. A matriz publicada nas docs e gerada dos
manifestos, entao nunca fica desatualizada nem promete demais.
