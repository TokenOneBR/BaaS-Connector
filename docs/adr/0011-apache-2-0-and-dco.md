# ADR 0011: Apache-2.0 com DCO, sem CLA

- **Status:** Aceito
- **Data:** 2026-08-28

## Contexto

O projeto fica entre provedores concorrentes de infraestrutura financeira, e
os adotantes alvo sao fintechs e bancos brasileiros.

## Decisao

Apache-2.0. Proveniencia por DCO (`git commit -s`), sem CLA.

## Por que Apache e nao MIT

**Grant de patente com terminacao defensiva (secao 3).** MIT nao concede
direito de patente. Numa area onde os contribuidores podem ser as mesmas
empresas cujas APIs embrulhamos, isso e risco concreto, nao teorico.

A protecao de marca (secao 6) tambem permite o `TRADEMARKS.md` sem acordo
separado.

## Por que nao AGPL

Seria um "nao" imediato dos OSPOs de banco — justamente os integradores que o
projeto precisa. E obrigaria a propria TokenOne a publicar as modificacoes do
servico hospedado.

## Por que DCO e nao CLA

Apache secao 5 ja resolve inbound=outbound. Um CLA adiciona friccao juridica e
um passo de assinatura que mata o PR de adapter feito de passagem, em troca de
beneficio marginal.

## Consequencias

Nao podemos absorver dependencia GPL/AGPL/SSPL. O
`dependency-review-action` bloqueia isso no CI.
