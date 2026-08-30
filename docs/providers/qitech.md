# QI Tech

**Esqueleto honesto com autenticação completa.** A referência de API da QI Tech
fica atrás de portal de parceiro. O que este pacote entrega e verifica é o
modelo de **autenticação** — que é o mais incomum dos cinco provedores e o
único que exigiu uma estratégia nova no `adapter-kit`.

## Autenticação: assinatura assimétrica

A QI Tech **não usa segredo compartilhado**. A autenticação é por par de
chaves: assinamos a requisição com a nossa privada, e verificamos a resposta
com a pública deles.

Isso é categoricamente diferente de HMAC, onde os dois lados compartilham o
mesmo segredo. O guia de adapters apontava `HmacSignatureStrategy` para a QI
Tech e **estava errado** — não é uma aproximação ruim, é impossível: não existe
segredo compartilhado para o `createHmac` usar. O kit ganhou
`AsymmetricJwtStrategy` por causa deste provedor.

| Peça | Papel |
|---|---|
| `apiKey` (header `API-CLIENT-KEY`) | Diz **quem** está chamando |
| JWS `ES512` assinado com `privateKey` | Prova que a requisição **não foi alterada** |
| `providerPublicKey` | Verifica a **resposta** |

Uma sem a outra não serve: a chave sozinha é um segredo compartilhado que
qualquer intermediário que a veja pode reusar.

O corpo enviado **é** o próprio JWS (`replaceBody`), e o `content-type` muda
para `application/jwt`.

### A verificação da resposta é metade do contrato

`QitechAdapter.verifyResponse` existe porque aceitar resposta não verificada
anularia o motivo de a assinatura existir: um intermediário poderia reescrever
o corpo de uma confirmação de pagamento e nós acreditaríamos.

Ela **lança** quando não confere — nunca devolve `false`, porque um chamador
que ignora o booleano é indistinguível de um que não verificou.

### Detalhe que decide se funciona

`dsaEncoding: 'ieee-p1363'`. O padrão do Node para ECDSA é DER, e o JWS exige a
forma crua R‖S. Assinar em DER produz um token que toda biblioteca de JWT
recusa, com erro que não diz por quê — o tipo de defeito que consome um dia de
integração. Há teste, e a mutação que troca por DER mata três deles.

## Contribuindo

As capacidades de domínio estão todas abertas. Se você tem acesso ao portal da
QI Tech, a autenticação já está pronta e testada — falta mapear as facetas.
