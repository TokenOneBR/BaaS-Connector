# @baasconn/contracts

## 0.2.0

### Minor Changes

- [`b8b8301`](https://github.com/TokenOneBR/BaaS-Connector/commit/b8b8301bbff863ae6d49fb2414eb1360667f099c) Thanks [@claude](https://github.com/claude)! - Alinha os contratos administrativos com o que a API realmente devolve.

  `zLoginResult` ganha `token_type` e o `user` aninhado, e **perde**
  `mfa_required`: a API lança `MFA_REQUIRED` quando o segundo fator falta, e
  devolver também uma flag daria duas fontes para a mesma verdade — o cliente que
  lesse a errada trataria uma recusa como sucesso.

  `zSession` ganha `session_id` e passa a descrever `GET /me` de verdade.

  `zReconciliationBreak` declara `adjustment_transaction_id`, que a rota já
  emitia sem estar no contrato.

  `zTriggerReconciliation.account_id` passa a ser **obrigatório**. A chave única
  de `ReconciliationRun` inclui a conta, e em Postgres NULL não é igual a NULL num
  índice único — um run de conexão inteira escaparia da deduplicação. Reconciliar
  uma conexão é outra operação: um _sweep_, que enumera as contas.

- [`02efbd4`](https://github.com/TokenOneBR/BaaS-Connector/commit/02efbd4bb6d516d31ccdcb1f92028fe6d3ea66bf) Thanks [@claude](https://github.com/claude)! - Adiciona `zOverview`, o agregado do painel do console.

  Uma rota, e não nove: o painel não pode custar nove idas ao BFF, cada uma com
  o round-trip de sessão, e um agregado próprio lê o necessário em vez de paginar
  quatro listas para descartar quase tudo.

  `reconciliation.last_success_at` é **nulo** quando nunca houve execução — zero
  mentiria "conciliado há pouco", e é exatamente esse campo que o alerta de
  obsolescência lê.

- [`e706a6b`](https://github.com/TokenOneBR/BaaS-Connector/commit/e706a6b0ab160315e522c4ec8d90f1dfc347453e) Thanks [@claude](https://github.com/claude)! - Publica o SDK, a spec OpenAPI e a documentacao.

  `@baasconn/sdk` e o cliente TypeScript da API canonica. Os tipos vem dos
  mesmos schemas Zod que a API usa para validar, entao uma mudanca no modelo
  canonico vira erro de compilacao no projeto de quem integra em vez de
  surpresa em runtime. O ambiente vem da chave (`bck_hml_`/`bck_prd_`), o 202
  de desfecho desconhecido tem tipo proprio (`BaasOutcomeUnknown`), e nao ha
  retry automatico — um retry cego numa transferencia e o caminho mais curto
  para o pagamento duplicado.

  `@baasconn/crypto` ganha `buildSignature`, `canonicalSignatureString` e
  `generateNonce`, que sairam de `apps/api`: um pacote publicado nao pode
  depender de um app, e o servidor que verifica precisa compartilhar UMA
  implementacao com o cliente que assina. `apps/api` reexporta.

  `@baasconn/contracts` ganha os contratos administrativos de webhook
  (`zInboundWebhookEvent`, `zAdminWebhookEndpoint`, `zAdminWebhookDelivery`),
  que estendem os publicos em vez de redeclara-los.

- [`42db844`](https://github.com/TokenOneBR/BaaS-Connector/commit/42db84462bb2e2354b5ba261e964abbb021491b6) Thanks [@claude](https://github.com/claude)! - Primeira versao da taxonomia canonica e dos contratos.

  `@baasconn/taxonomy` traz o vocabulario compartilhado: `Money` em unidades
  menores com alocacao sem residuo, identificadores ULID com prefixo e tipo
  marcado, maquinas de estado com guard monotonico para ingestao de webhook,
  catalogo de erros canonicos separando `retryable` de `safeToRetry`, validadores
  de CPF/CNPJ/telefone/CEP e um codec completo de BR Code (EMV MPM) com CRC.

  `@baasconn/contracts` traz os DTOs em Zod que servem simultaneamente de
  validacao de requisicao, tipo do handler e fonte do OpenAPI.

- [`a866ee3`](https://github.com/TokenOneBR/BaaS-Connector/commit/a866ee3e94d459eb9694b47f7e4e239737188656) Thanks [@claude](https://github.com/claude)! - `ProviderAdapterFactory` ganha `credentialsDisplayField`: qual credencial pode
  ter os últimos quatro caracteres exibidos no console.

  Não há resposta genérica segura — `last4` de um `clientSecret` vaza quatro
  caracteres de um segredo. Só o adapter sabe qual das credenciais é um
  **identificador** (`clientId`, `appId`) em vez de um segredo. Sem a declaração,
  o console mostra apenas o fingerprint, que é o padrão seguro.

  `zCreateApiKey` ganha `signing_required`, opcional, para permitir **ligar** a
  assinatura HMAC em homologação. Em produção com `pix:write` ela é forçada, e um
  `false` explícito é recusado com 422 em vez de sobrescrito em silêncio.

- [`e706a6b`](https://github.com/TokenOneBR/BaaS-Connector/commit/e706a6b0ab160315e522c4ec8d90f1dfc347453e) Thanks [@claude](https://github.com/claude)! - Adiciona os contratos das rotas administrativas de webhook: eventos de
  entrada, endpoints do cliente e entregas de saida. Os dois ultimos estendem
  os contratos publicos com `.extend`/`.omit` em vez de redeclarar os campos —
  sao os mesmos campos, e duas declaracoes da mesma forma divergem na primeira
  mudanca. O `secret` do contrato publico e retirado por `.omit`, porque
  nenhuma rota administrativa o serve.

### Patch Changes

- [`95424e1`](https://github.com/TokenOneBR/BaaS-Connector/commit/95424e116f6ea59b8554178074e45b826f800d00) Thanks [@claude](https://github.com/claude)! - Fluxos de dinheiro: saldo com cache, chaves Pix, cobrancas, Pix in/out,
  devolucao, extrato e o caminho de desfecho desconhecido.

  Na taxonomia, dois acrescimos aditivos: o evento `pix_refund.created`, que
  faltava — havia `received` (entrada) e `settled`, mas nenhum para o momento em
  que o provedor aceita uma devolucao que NOS enviamos — e a exportacao de
  `StatementEntryDto` nos contratos.

  Nenhuma quebra de contrato publico: os enums, as tabelas de transicao e o
  formato de dinheiro no wire seguem iguais.

- Updated dependencies [[`2df13aa`](https://github.com/TokenOneBR/BaaS-Connector/commit/2df13aaddb538eba04dfab81619c38531724f210), [`2dbb13b`](https://github.com/TokenOneBR/BaaS-Connector/commit/2dbb13bcdbb8fe2b45eb069059b73e9368905bba), [`42db844`](https://github.com/TokenOneBR/BaaS-Connector/commit/42db84462bb2e2354b5ba261e964abbb021491b6), [`95424e1`](https://github.com/TokenOneBR/BaaS-Connector/commit/95424e116f6ea59b8554178074e45b826f800d00), [`b7109b7`](https://github.com/TokenOneBR/BaaS-Connector/commit/b7109b7f4dd77c2ee26dc9486f593a57d44212b5), [`a8b2d37`](https://github.com/TokenOneBR/BaaS-Connector/commit/a8b2d3784faf4ef9223cbdb9e178e2c39dbd0bf2), [`8cdc13b`](https://github.com/TokenOneBR/BaaS-Connector/commit/8cdc13b88ba5c91112fcd22f549aa7f0cf73b9d9)]:
  - @baasconn/taxonomy@0.2.0
