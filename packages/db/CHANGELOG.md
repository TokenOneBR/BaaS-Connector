# @baasconn/db

## 0.2.0

### Minor Changes

- [`120cfde`](https://github.com/TokenOneBR/BaaS-Connector/commit/120cfde2730a1ead0c8ba613390c004902543a5a) Thanks [@claude](https://github.com/claude)! - Envelope encryption com KMS plugavel, observabilidade com redacao por nome de
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

- [`a8b2d37`](https://github.com/TokenOneBR/BaaS-Connector/commit/a8b2d3784faf4ef9223cbdb9e178e2c39dbd0bf2) Thanks [@claude](https://github.com/claude)! - Escada do desfecho desconhecido na taxonomia, e `Prisma` exportado como valor
  por `@baasconn/db`.

  `UNKNOWN_OUTCOME_LADDER_SECONDS` mora ao lado da escada de webhook porque e
  decisao de PRODUTO e nao detalhe do worker: a ADR 0015 a cita como parte do
  contrato de um `202`. Os primeiros degraus sao curtos porque a maioria dos
  desfechos desconhecidos resolve em segundos — o POST chegou, a resposta e que
  se perdeu — e cada degrau que passa e saldo do cliente travado.

  `Prisma` sai de `@baasconn/db` como valor porque zerar uma coluna Json exige
  `Prisma.DbNull`: `null` cru grava JSON null, que e coisa diferente de NULL do
  SQL, e o tipo gerado recusa o cru justamente para o autor escolher.

### Patch Changes

- Updated dependencies [[`2df13aa`](https://github.com/TokenOneBR/BaaS-Connector/commit/2df13aaddb538eba04dfab81619c38531724f210), [`2dbb13b`](https://github.com/TokenOneBR/BaaS-Connector/commit/2dbb13bcdbb8fe2b45eb069059b73e9368905bba), [`120cfde`](https://github.com/TokenOneBR/BaaS-Connector/commit/120cfde2730a1ead0c8ba613390c004902543a5a), [`e706a6b`](https://github.com/TokenOneBR/BaaS-Connector/commit/e706a6b0ab160315e522c4ec8d90f1dfc347453e), [`42db844`](https://github.com/TokenOneBR/BaaS-Connector/commit/42db84462bb2e2354b5ba261e964abbb021491b6), [`34993ce`](https://github.com/TokenOneBR/BaaS-Connector/commit/34993ce30fb65fbe181e394cc84fc4e6d653190a), [`95424e1`](https://github.com/TokenOneBR/BaaS-Connector/commit/95424e116f6ea59b8554178074e45b826f800d00), [`b7109b7`](https://github.com/TokenOneBR/BaaS-Connector/commit/b7109b7f4dd77c2ee26dc9486f593a57d44212b5), [`1ce63e2`](https://github.com/TokenOneBR/BaaS-Connector/commit/1ce63e2c184d95525d2d662d4c39f02cc84fd362), [`a8b2d37`](https://github.com/TokenOneBR/BaaS-Connector/commit/a8b2d3784faf4ef9223cbdb9e178e2c39dbd0bf2), [`8cdc13b`](https://github.com/TokenOneBR/BaaS-Connector/commit/8cdc13b88ba5c91112fcd22f549aa7f0cf73b9d9)]:
  - @baasconn/taxonomy@0.2.0
  - @baasconn/crypto@0.2.0
  - @baasconn/ledger@0.2.0
