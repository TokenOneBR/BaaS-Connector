# ADR 0010: Idempotencia em duas camadas e outbox transacional

- **Status:** Aceito
- **Data:** 2026-08-28

## Contexto

Duas garantias distintas: o cliente repetir a requisicao nao pode duplicar
efeito, e o nosso retry interno nao pode duplicar pagamento no banco.

## Decisao

**Duas camadas explicitamente separadas.** A `Idempotency-Key` do cliente
grava um `IdempotencyRecord` no Postgres com um `operation_id` proprio; e o
`operation_id` — nunca a chave do cliente — que vai como chave de idempotencia
ao provedor.

**Eventos por outbox transacional**: inseridos na mesma transacao da mudanca
de dominio, relaiados por um dispatcher.

## Por que a chave do cliente nao passa direto

1. Chave de cliente e string arbitraria e alguns provedores exigem UUID.
2. As vezes precisamos de uma **segunda** chamada ao provedor para a mesma
   chave do cliente (devolucao parcial), e o mapeamento precisa ser um-para-um
   com a nossa operacao.

## Por que Postgres e nao Redis

O registro de idempotencia precisa estar na **mesma transacao** da escrita de
dominio para a garantia de "exatamente um efeito" valer. Redis mais Postgres
sao dois sistemas que podem discordar. Redis fica so como cache negativo.

## O caso do desfecho desconhecido

Timeout de headers ou body num POST que move dinheiro nao e falha: e
**desfecho indeterminado**. O registro **nao** e deletado (deletar permitiria
pagamento duplo), a resposta e **202**, e um job resolve consultando o
provedor. Um 5xx aqui convidaria o cliente a retentar, que e exatamente o
risco.

## Consequencias

Mais tabelas e um dispatcher para operar. Em troca, "nunca contamos ao cliente
um pagamento que nao registramos, e nunca deixamos de contar um que
registramos" vira propriedade estrutural.
