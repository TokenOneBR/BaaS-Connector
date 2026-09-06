# @baasconn/taxonomy

## 0.2.0

### Minor Changes

- [`2df13aa`](https://github.com/TokenOneBR/BaaS-Connector/commit/2df13aaddb538eba04dfab81619c38531724f210) Thanks [@claude](https://github.com/claude)! - Primeiro adapter de provedor: o Mock Bank, implementado por inteiro contra o
  SPI facetado.

  - `adapter-mock-bank`: contas, onboarding, saldo, chaves PIX, cobrancas, PIX
    in/out, devolucao, extrato e webhooks, com manifesto honesto (EMULATED e
    PARTIAL onde o provedor nao entrega o comportamento pleno) e conformidade
    verde nos 10 grupos.
  - `conformance`: corrige o grupo da matriz de erros, que servia as fixtures
    felizes e as de erro no mesmo servidor — a resposta 200 casava primeiro em
    toda rota que os dois conjuntos cobriam, entao a fixture de erro nunca era
    alcancada e o teste passava sem exercitar nada.
  - `taxonomy`: novo `PROVIDER_INTERNAL_ERROR` (502). Nao havia codigo para
    "o servidor do provedor falhou" — o unico destino era `PROVIDER_REJECTED`,
    que e o fallback da tabela de mapeamento e portanto reprovado pela
    conformidade.

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

- [`42db844`](https://github.com/TokenOneBR/BaaS-Connector/commit/42db84462bb2e2354b5ba261e964abbb021491b6) Thanks [@claude](https://github.com/claude)! - Primeira versao da taxonomia canonica e dos contratos.

  `@baasconn/taxonomy` traz o vocabulario compartilhado: `Money` em unidades
  menores com alocacao sem residuo, identificadores ULID com prefixo e tipo
  marcado, maquinas de estado com guard monotonico para ingestao de webhook,
  catalogo de erros canonicos separando `retryable` de `safeToRetry`, validadores
  de CPF/CNPJ/telefone/CEP e um codec completo de BR Code (EMV MPM) com CRC.

  `@baasconn/contracts` traz os DTOs em Zod que servem simultaneamente de
  validacao de requisicao, tipo do handler e fonte do OpenAPI.

- [`95424e1`](https://github.com/TokenOneBR/BaaS-Connector/commit/95424e116f6ea59b8554178074e45b826f800d00) Thanks [@claude](https://github.com/claude)! - Fluxos de dinheiro: saldo com cache, chaves Pix, cobrancas, Pix in/out,
  devolucao, extrato e o caminho de desfecho desconhecido.

  Na taxonomia, dois acrescimos aditivos: o evento `pix_refund.created`, que
  faltava — havia `received` (entrada) e `settled`, mas nenhum para o momento em
  que o provedor aceita uma devolucao que NOS enviamos — e a exportacao de
  `StatementEntryDto` nos contratos.

  Nenhuma quebra de contrato publico: os enums, as tabelas de transicao e o
  formato de dinheiro no wire seguem iguais.

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

- [`8cdc13b`](https://github.com/TokenOneBR/BaaS-Connector/commit/8cdc13b88ba5c91112fcd22f549aa7f0cf73b9d9) Thanks [@claude](https://github.com/claude)! - Fatia vertical de conta e onboarding na API, com ingestao de webhook, outbox
  transacional e trilha de auditoria. Sem mudanca de contrato publico na
  taxonomia — apenas o uso dos guards monotonicos ja existentes.
