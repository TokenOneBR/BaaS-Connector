---
'@baasconn/adapter-kit': minor
---

Adiciona `AsymmetricJwtStrategy`: assinatura assimétrica por requisição, em
JWS compacto, com `ES256`/`ES512`/`RS256`/`RS512`.

O kit só cobria HMAC, que é simétrico. Provedores como a QI Tech assinam com
par de chaves — e não é uma aproximação ruim tratar isso como HMAC, é
impossível: não existe segredo compartilhado para o `createHmac` usar. O guia
de adapters apontava `HmacSignatureStrategy` para a QI Tech e estava errado;
foi corrigido.

Inclui `verifyResponse`, porque nesses provedores a assinatura da **resposta**
é metade do contrato: aceitar resposta não verificada anula o motivo de a
assinatura existir — um intermediário poderia reescrever o corpo de uma
confirmação de pagamento e acreditaríamos.
