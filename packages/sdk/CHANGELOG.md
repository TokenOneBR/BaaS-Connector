# @baasconn/sdk

## 0.2.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [[`2df13aa`](https://github.com/TokenOneBR/BaaS-Connector/commit/2df13aaddb538eba04dfab81619c38531724f210), [`2dbb13b`](https://github.com/TokenOneBR/BaaS-Connector/commit/2dbb13bcdbb8fe2b45eb069059b73e9368905bba), [`b8b8301`](https://github.com/TokenOneBR/BaaS-Connector/commit/b8b8301bbff863ae6d49fb2414eb1360667f099c), [`02efbd4`](https://github.com/TokenOneBR/BaaS-Connector/commit/02efbd4bb6d516d31ccdcb1f92028fe6d3ea66bf), [`120cfde`](https://github.com/TokenOneBR/BaaS-Connector/commit/120cfde2730a1ead0c8ba613390c004902543a5a), [`e706a6b`](https://github.com/TokenOneBR/BaaS-Connector/commit/e706a6b0ab160315e522c4ec8d90f1dfc347453e), [`42db844`](https://github.com/TokenOneBR/BaaS-Connector/commit/42db84462bb2e2354b5ba261e964abbb021491b6), [`95424e1`](https://github.com/TokenOneBR/BaaS-Connector/commit/95424e116f6ea59b8554178074e45b826f800d00), [`b7109b7`](https://github.com/TokenOneBR/BaaS-Connector/commit/b7109b7f4dd77c2ee26dc9486f593a57d44212b5), [`a866ee3`](https://github.com/TokenOneBR/BaaS-Connector/commit/a866ee3e94d459eb9694b47f7e4e239737188656), [`a8b2d37`](https://github.com/TokenOneBR/BaaS-Connector/commit/a8b2d3784faf4ef9223cbdb9e178e2c39dbd0bf2), [`8cdc13b`](https://github.com/TokenOneBR/BaaS-Connector/commit/8cdc13b88ba5c91112fcd22f549aa7f0cf73b9d9), [`e706a6b`](https://github.com/TokenOneBR/BaaS-Connector/commit/e706a6b0ab160315e522c4ec8d90f1dfc347453e)]:
  - @baasconn/taxonomy@0.2.0
  - @baasconn/crypto@0.2.0
  - @baasconn/contracts@0.2.0
