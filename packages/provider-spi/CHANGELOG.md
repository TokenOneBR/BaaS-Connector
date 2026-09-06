# @baasconn/provider-spi

## 0.2.0

### Minor Changes

- [`2dbb13b`](https://github.com/TokenOneBR/BaaS-Connector/commit/2dbb13bcdbb8fe2b45eb069059b73e9368905bba) Thanks [@claude](https://github.com/claude)! - Esqueleto da API: autenticacao por API key com assinatura HMAC, sessao do
  console com JWT assimetrico e refresh rotativo, interceptor de idempotencia e
  repositorios Prisma.

  - `taxonomy`: novos codigos `SESSION_EXPIRED` e `MFA_REQUIRED`, com mensagens
    em pt-BR. `MFA_REQUIRED` e separado de `AUTHENTICATION_FAILED` porque a acao
    do cliente e pedir o codigo TOTP, nao a senha de novo.
  - `crypto`: TOTP (RFC 6238) com codificacao base32, verificado contra os
    vetores normativos do Apendice B.
  - `provider-spi`: campo opcional `capability` em `ProviderCallRecord`, para a
    metrica de SLI agrupar por capacidade canonica em vez de caminho HTTP do
    provedor — que tornaria o painel incomparavel entre provedores.

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

- [`a866ee3`](https://github.com/TokenOneBR/BaaS-Connector/commit/a866ee3e94d459eb9694b47f7e4e239737188656) Thanks [@claude](https://github.com/claude)! - `ProviderAdapterFactory` ganha `credentialsDisplayField`: qual credencial pode
  ter os últimos quatro caracteres exibidos no console.

  Não há resposta genérica segura — `last4` de um `clientSecret` vaza quatro
  caracteres de um segredo. Só o adapter sabe qual das credenciais é um
  **identificador** (`clientId`, `appId`) em vez de um segredo. Sem a declaração,
  o console mostra apenas o fingerprint, que é o padrão seguro.

  `zCreateApiKey` ganha `signing_required`, opcional, para permitir **ligar** a
  assinatura HMAC em homologação. Em produção com `pix:write` ela é forçada, e um
  `false` explícito é recusado com 422 em vez de sobrescrito em silêncio.

- [`1ce63e2`](https://github.com/TokenOneBR/BaaS-Connector/commit/1ce63e2c184d95525d2d662d4c39f02cc84fd362) Thanks [@claude](https://github.com/claude)! - SPI de provedores, ferramentaria de adapter, suite de conformidade e motor de
  ledger de partidas dobradas.

  O SPI e facetado com manifesto de capacidades: faceta ausente e um fato
  verificavel, enquanto stub que lanca excecao e indistinguivel de "suportado".
  A validacao de boot recusa manifesto que promete capacidade sem a faceta, e
  recusa provedor sem idempotencia que nao implemente busca pela nossa chave.

  O kit carrega a regra que impede pagamento duplo: escrita nao idempotente cuja
  falha nao e provadamente pre-commit vira ProviderOutcomeUnknownError, nunca
  retry.

  O ledger e em duas fases, com guarda de saldo negativo e ordem deterministica
  de lock.

- [`9e41ad0`](https://github.com/TokenOneBR/BaaS-Connector/commit/9e41ad0872ad3af5ec6ee557e8c3e4613508ee58) Thanks [@claude](https://github.com/claude)! - Extrato do SPI passa a carregar saldo de abertura e de fechamento, e o Mock
  Bank pagina de verdade.

  Os saldos sao OPCIONAIS de proposito. Exigi-los obrigaria todo adapter a
  devolver um numero mesmo sem ter como calcula-lo, e o caminho de menor esforco
  seria repetir o saldo atual. Um saldo ausente a conciliacao declara como passe
  pulado; um saldo inventado ela acredita, e passa a abrir quebra de saldo em
  cima de ficcao.

  Opcionais no SPI, obrigatoriamente coerentes na conformidade: o grupo 11 novo
  cobra que `abertura + Σ(creditos − debitos da janela) = fechamento` feche, e
  que paginar termine sem repetir cursor nem linha. Os dois saldos precisam vir
  de fontes independentes — o razao e as linhas — senao a assercao vira
  tautologia.

  A tarifa vira linha propria de extrato, com `StatementEntryType.FEE`. O razao
  debita `valor + tarifa` da conta do cliente; sem a linha, a soma nao bate com a
  variacao de saldo em toda conta que paga tarifa.

  Ver ADR 0016.

### Patch Changes

- Updated dependencies [[`2df13aa`](https://github.com/TokenOneBR/BaaS-Connector/commit/2df13aaddb538eba04dfab81619c38531724f210), [`2dbb13b`](https://github.com/TokenOneBR/BaaS-Connector/commit/2dbb13bcdbb8fe2b45eb069059b73e9368905bba), [`42db844`](https://github.com/TokenOneBR/BaaS-Connector/commit/42db84462bb2e2354b5ba261e964abbb021491b6), [`95424e1`](https://github.com/TokenOneBR/BaaS-Connector/commit/95424e116f6ea59b8554178074e45b826f800d00), [`b7109b7`](https://github.com/TokenOneBR/BaaS-Connector/commit/b7109b7f4dd77c2ee26dc9486f593a57d44212b5), [`a8b2d37`](https://github.com/TokenOneBR/BaaS-Connector/commit/a8b2d3784faf4ef9223cbdb9e178e2c39dbd0bf2), [`8cdc13b`](https://github.com/TokenOneBR/BaaS-Connector/commit/8cdc13b88ba5c91112fcd22f549aa7f0cf73b9d9)]:
  - @baasconn/taxonomy@0.2.0
