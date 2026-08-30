-- Duas bases, e a separacao e o ponto.
--
-- `baas_mockbank` nao tem foreign key nenhuma para `baas`: o Mock Bank
-- precisa ser genuinamente EXTERNO. Fossem a mesma base, um teste de contrato
-- poderia casar registros com um join, e um bug real de integracao — do tipo
-- "o adapter le o campo errado do provedor" — nunca apareceria.
--
-- Roda uma vez, na inicializacao do volume. Recriar o volume e o unico jeito
-- de reexecutar, que e exatamente a semantica que se quer de um script de
-- criacao de banco.
SELECT 'CREATE DATABASE baas_mockbank'
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'baas_mockbank')\gexec
