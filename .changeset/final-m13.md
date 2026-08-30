---
'@baasconn/sdk': minor
'@baasconn/crypto': minor
'@baasconn/contracts': minor
---

Publica o SDK, a spec OpenAPI e a documentacao.

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
