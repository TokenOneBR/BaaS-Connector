# ADR 0004: Mock Bank como servico autonomo, nao fake em processo

- **Status:** Aceito
- **Data:** 2026-08-28

## Contexto

O stakeholder pediu "um Mock Bank BaaS para testes mocados, seguindo alguma
referencia de ledger dos demais".

## Decisao

`apps/mock-bank` e um servico NestJS deployavel, com banco proprio e ledger de
partidas dobradas real, mais um adapter fino que fala com ele pelo SPI como
qualquer outro provedor. Suporta `MOCK_BANK_STORE=memory` para testes rapidos.

## Alternativas consideradas

**Fake em processo implementando o SPI.** Mais rapido nos testes, mas:

1. O pedido foi por um **BaaS falso**, nao por um adapter falso. Como servico,
   e utilizavel por um time Python, por teste de carga, por um parceiro
   integrando contra o conector e por demo.
2. **PIX e assincrono.** Os modos de falha interessantes sao entrega de
   webhook, evento fora de ordem, evento duplicado, liquidacao atrasada,
   timeout e retry. Um fake em processo nao exercita nenhum deles.
3. Com o salto HTTP real, o codigo de timeout, retry, idempotencia e circuit
   breaker do conector fica no caminho critico de todo teste e2e.
4. O adapter correspondente custa quase nada e forca o Mock Bank pelo mesmo
   SPI que a Celcoin, que e a melhor prova de que o SPI e agnostico.

## Consequencias

Mais um deployable e mais um banco. Mitigado pelo modo `memory`, que roda
in-process com supertest em ~50ms para unit e conformidade.

O Mock Bank e **intencionalmente inseguro** (endpoints `_control` sem auth
forte) e esta fora do escopo de seguranca. O chart o mantem desabilitado por
padrao.
