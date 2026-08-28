---
'@baasconn/taxonomy': minor
'@baasconn/crypto': minor
'@baasconn/provider-spi': minor
---

Esqueleto da API: autenticacao por API key com assinatura HMAC, sessao do
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
