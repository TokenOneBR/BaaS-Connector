---
'@baasconn/provider-spi': minor
'@baasconn/contracts': minor
---

`ProviderAdapterFactory` ganha `credentialsDisplayField`: qual credencial pode
ter os últimos quatro caracteres exibidos no console.

Não há resposta genérica segura — `last4` de um `clientSecret` vaza quatro
caracteres de um segredo. Só o adapter sabe qual das credenciais é um
**identificador** (`clientId`, `appId`) em vez de um segredo. Sem a declaração,
o console mostra apenas o fingerprint, que é o padrão seguro.

`zCreateApiKey` ganha `signing_required`, opcional, para permitir **ligar** a
assinatura HMAC em homologação. Em produção com `pix:write` ela é forçada, e um
`false` explícito é recusado com 422 em vez de sobrescrito em silêncio.
