---
'@baasconn/adapter-woovi': minor
'@baasconn/adapter-asaas': minor
'@baasconn/adapter-dock': minor
'@baasconn/adapter-qitech': minor
---

Adiciona Woovi, Asaas, Dock e QI Tech.

Woovi e Asaas trazem uma fatia real: cobrança PIX (Woovi) e saldo mais chaves
PIX (Asaas), sobre autenticação por header — `Authorization: <AppID>` sem
`Bearer` e `access_token`, respectivamente.

Dock e QI Tech publicam a referência de API atrás de portal de parceiro, então
entregam **autenticação verificada e manifesto vazio**. Declarar capacidade a
partir de suposição seria pior do que não declarar: a matriz publicada é o
artefato de maior valor do repositório, e ela só vale enquanto ninguém precisar
conferir se é verdade.

A QI Tech é o único dos cinco com assinatura assimétrica (JWS ES512, requisição
e resposta) e foi o motivo de `AsymmetricJwtStrategy` existir.
