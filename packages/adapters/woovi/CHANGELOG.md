# @baasconn/adapter-woovi

## 0.2.0

### Minor Changes

- [`85435b8`](https://github.com/TokenOneBR/BaaS-Connector/commit/85435b806d68e83c8d51671df901944040a5eb48) Thanks [@claude](https://github.com/claude)! - Adiciona o esqueleto do adapter Woovi.

- [`85435b8`](https://github.com/TokenOneBR/BaaS-Connector/commit/85435b806d68e83c8d51671df901944040a5eb48) Thanks [@claude](https://github.com/claude)! - Adiciona Woovi, Asaas, Dock e QI Tech.

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

### Patch Changes

- Updated dependencies [[`2df13aa`](https://github.com/TokenOneBR/BaaS-Connector/commit/2df13aaddb538eba04dfab81619c38531724f210), [`2dbb13b`](https://github.com/TokenOneBR/BaaS-Connector/commit/2dbb13bcdbb8fe2b45eb069059b73e9368905bba), [`01bd80a`](https://github.com/TokenOneBR/BaaS-Connector/commit/01bd80ac614ca5c6e23278df0aee116f932f6e56), [`42db844`](https://github.com/TokenOneBR/BaaS-Connector/commit/42db84462bb2e2354b5ba261e964abbb021491b6), [`95424e1`](https://github.com/TokenOneBR/BaaS-Connector/commit/95424e116f6ea59b8554178074e45b826f800d00), [`b7109b7`](https://github.com/TokenOneBR/BaaS-Connector/commit/b7109b7f4dd77c2ee26dc9486f593a57d44212b5), [`a866ee3`](https://github.com/TokenOneBR/BaaS-Connector/commit/a866ee3e94d459eb9694b47f7e4e239737188656), [`1ce63e2`](https://github.com/TokenOneBR/BaaS-Connector/commit/1ce63e2c184d95525d2d662d4c39f02cc84fd362), [`9e41ad0`](https://github.com/TokenOneBR/BaaS-Connector/commit/9e41ad0872ad3af5ec6ee557e8c3e4613508ee58), [`a8b2d37`](https://github.com/TokenOneBR/BaaS-Connector/commit/a8b2d3784faf4ef9223cbdb9e178e2c39dbd0bf2), [`8cdc13b`](https://github.com/TokenOneBR/BaaS-Connector/commit/8cdc13b88ba5c91112fcd22f549aa7f0cf73b9d9)]:
  - @baasconn/taxonomy@0.2.0
  - @baasconn/provider-spi@0.2.0
  - @baasconn/adapter-kit@0.2.0
