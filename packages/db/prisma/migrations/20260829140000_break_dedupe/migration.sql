-- Deduplicacao de quebra de conciliacao.
--
-- A unica de `(connection_id, type, end_to_end_id, effective_date)` prometia,
-- no comentario do schema, que "a mesma quebra nao vira duas". Ela nao
-- entregava: `end_to_end_id` e NULLABLE e, em Postgres, NULL nunca e igual a
-- NULL num indice unico. Toda quebra sem E2EID — BALANCE_MISMATCH, que nunca
-- tem; UNMATCHED_FEE; MISSING_ON_PROVIDER de item que ainda nao ganhou E2EID —
-- escapava da dedup. A execucao intraday roda a cada 30 minutos: eram 48
-- linhas por dia, por conta, para a MESMA quebra.
--
-- A correcao NAO e `NULLS NOT DISTINCT` nem `COALESCE(end_to_end_id, '')`.
-- As duas consertam o sintoma e introduzem um defeito pior: colapsam numa
-- linha so TODAS as quebras do mesmo (conexao, tipo, data) sem E2EID. Dois
-- debitos fantasma distintos, de R$ 300 e de R$ 5.000 no mesmo dia, virariam
-- uma quebra — e o operador resolveria uma achando que resolveu as duas.
--
-- A chave passa a ser uma coluna DERIVADA e NOT NULL, calculada pelo motor:
--   e2e:<endToEndId>        quando ha E2EID
--   bal:<accountId>         BALANCE_MISMATCH — uma por conta por dia, que e
--                           exatamente o escopo de um saldo
--   pitem:<providerEntryId> item do provedor sem E2EID, estavel entre execucoes
--   litem:<transactionId>   item local ou lancamento de razao orfao, ULID nosso
ALTER TABLE "reconciliation_break" ADD COLUMN "dedupe_key" VARCHAR(160);

-- Backfill antes do NOT NULL. `legacy:` usa o proprio id: nao ha como derivar
-- a chave natural de uma linha antiga, e colapsa-las agora seria inventar uma
-- igualdade que ninguem verificou.
UPDATE "reconciliation_break"
   SET "dedupe_key" = COALESCE('e2e:' || "end_to_end_id", 'legacy:' || "id");

ALTER TABLE "reconciliation_break" ALTER COLUMN "dedupe_key" SET NOT NULL;

DROP INDEX IF EXISTS "reconciliation_break_connection_id_type_end_to_end_id_effec_key";

CREATE UNIQUE INDEX "reconciliation_break_dedupe_uq"
  ON "reconciliation_break" ("connection_id", "type", "effective_date", "dedupe_key");
