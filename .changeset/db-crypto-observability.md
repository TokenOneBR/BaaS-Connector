---
"@baasconn/crypto": minor
"@baasconn/observability": minor
"@baasconn/db": minor
---

Envelope encryption com KMS plugavel, observabilidade com redacao por nome de
chave, e o schema Prisma do conector.

`@baasconn/crypto` traz envelope encryption (DEK aleatoria por registro,
envolvida pelo KMS), blind index para busca por documento sem descriptografar a
tabela, e Argon2id com indice de lookup para autenticar em uma leitura indexada.

`@baasconn/observability` redige por NOME DE CHAVE em qualquer profundidade: a
opcao `redact.paths` do pino casa exatamente um nivel de aninhamento e deixa
passar chave no topo e em profundidade 3.

`@baasconn/db` traz o schema single-tenant particionado por ambiente, mais as
invariantes que so o banco garante: CHECK de saldo negativo, trigger deferrable
de balanceamento, imutabilidade de lancamento, auditoria append-only com cadeia
de hash e indices unicos parciais.
