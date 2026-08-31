# @baasconn/reconciliation

## 0.2.0

### Minor Changes

- [`9e41ad0`](https://github.com/TokenOneBR/BaaS-Connector/commit/9e41ad0872ad3af5ec6ee557e8c3e4613508ee58) Thanks [@claude](https://github.com/claude)! - Motor de conciliacao em tres vias: provedor, registros canonicos e razao
  sombra. Cinco passes puros, sem framework e sem I/O, que devolvem um PLANO —
  casamentos, rascunhos de quebra, contadores e intencoes de auto-resolucao — e
  nunca efeitos.

  A ordem dos passes e regra e nao preferencia: a chave forte roda primeiro
  porque o passe fuzzy pareia por proximidade de instante e roubaria um
  casamento que o E2EID faria com certeza.

  Calendario bancario nacional calculado, nao tabelado, com os feriados
  derivados da Pascoa por Meeus. Uma tabela de feriados fica errada em silencio,
  e o unico sintoma seria um `DATE_MISMATCH` falso em fevereiro.

- [`b7109b7`](https://github.com/TokenOneBR/BaaS-Connector/commit/b7109b7f4dd77c2ee26dc9486f593a57d44212b5) Thanks [@claude](https://github.com/claude)! - Conciliação em três vias, executável de ponta a ponta.

  `@baasconn/reconciliation` estreia como pacote: o motor de casamento em cinco
  passes, puro e sem I/O, que compara extrato do provedor, registros canônicos e
  razão sombra e devolve um **plano** — casamentos, rascunhos de quebra e
  intenções de auto-resolução — em vez de efeitos. Inclui o calendário bancário
  brasileiro calculado (fixos nacionais mais os derivados da Páscoa por Meeus),
  atrás da porta `BusinessCalendar`.

  `@baasconn/taxonomy` ganha `UNKNOWN_OUTCOME_LADDER_SECONDS`, a escada de
  reconsulta de desfecho desconhecido citada na ADR 0015. Fica ao lado da escada
  de retry de webhook porque é decisão de produto, não detalhe do worker.

  `@baasconn/provider-spi` ganha `StatementPage`, que estende `Page<StatementEntry>`
  com `openingBalance` e `closingBalance` **opcionais**. É aditivo e
  retrocompatível — todo adapter existente continua compilando —, e a asserção de
  saldo declara honestamente quando pula por falta do dado. Obrigatórios forçariam
  todo adapter a inventar um número, e um saldo inventado é pior que um saldo
  ausente: o ausente o motor declara, o inventado ele acredita.

  Ver ADR 0017 (conciliação em três vias) e ADR 0018 (lock por agregado, e por
  que grupos do BullMQ não servem).

### Patch Changes

- Updated dependencies [[`2df13aa`](https://github.com/TokenOneBR/BaaS-Connector/commit/2df13aaddb538eba04dfab81619c38531724f210), [`2dbb13b`](https://github.com/TokenOneBR/BaaS-Connector/commit/2dbb13bcdbb8fe2b45eb069059b73e9368905bba), [`42db844`](https://github.com/TokenOneBR/BaaS-Connector/commit/42db84462bb2e2354b5ba261e964abbb021491b6), [`95424e1`](https://github.com/TokenOneBR/BaaS-Connector/commit/95424e116f6ea59b8554178074e45b826f800d00), [`b7109b7`](https://github.com/TokenOneBR/BaaS-Connector/commit/b7109b7f4dd77c2ee26dc9486f593a57d44212b5), [`a8b2d37`](https://github.com/TokenOneBR/BaaS-Connector/commit/a8b2d3784faf4ef9223cbdb9e178e2c39dbd0bf2), [`8cdc13b`](https://github.com/TokenOneBR/BaaS-Connector/commit/8cdc13b88ba5c91112fcd22f549aa7f0cf73b9d9)]:
  - @baasconn/taxonomy@0.2.0
