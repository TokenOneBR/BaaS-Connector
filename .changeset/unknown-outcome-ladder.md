---
'@baasconn/taxonomy': minor
'@baasconn/db': minor
---

Escada do desfecho desconhecido na taxonomia, e `Prisma` exportado como valor
por `@baasconn/db`.

`UNKNOWN_OUTCOME_LADDER_SECONDS` mora ao lado da escada de webhook porque e
decisao de PRODUTO e nao detalhe do worker: a ADR 0015 a cita como parte do
contrato de um `202`. Os primeiros degraus sao curtos porque a maioria dos
desfechos desconhecidos resolve em segundos — o POST chegou, a resposta e que
se perdeu — e cada degrau que passa e saldo do cliente travado.

`Prisma` sai de `@baasconn/db` como valor porque zerar uma coluna Json exige
`Prisma.DbNull`: `null` cru grava JSON null, que e coisa diferente de NULL do
SQL, e o tipo gerado recusa o cru justamente para o autor escolher.
