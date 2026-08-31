# @baasconn/adapter-kit

## 0.2.0

### Minor Changes

- [`01bd80a`](https://github.com/TokenOneBR/BaaS-Connector/commit/01bd80ac614ca5c6e23278df0aee116f932f6e56) Thanks [@claude](https://github.com/claude)! - Adiciona `AsymmetricJwtStrategy`: assinatura assimétrica por requisição, em
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

- [`1ce63e2`](https://github.com/TokenOneBR/BaaS-Connector/commit/1ce63e2c184d95525d2d662d4c39f02cc84fd362) Thanks [@claude](https://github.com/claude)! - SPI de provedores, ferramentaria de adapter, suite de conformidade e motor de
  ledger de partidas dobradas.

  O SPI e facetado com manifesto de capacidades: faceta ausente e um fato
  verificavel, enquanto stub que lanca excecao e indistinguivel de "suportado".
  A validacao de boot recusa manifesto que promete capacidade sem a faceta, e
  recusa provedor sem idempotencia que nao implemente busca pela nossa chave.

  O kit carrega a regra que impede pagamento duplo: escrita nao idempotente cuja
  falha nao e provadamente pre-commit vira ProviderOutcomeUnknownError, nunca
  retry.

  O ledger e em duas fases, com guarda de saldo negativo e ordem deterministica
  de lock.

### Patch Changes

- Updated dependencies [[`2df13aa`](https://github.com/TokenOneBR/BaaS-Connector/commit/2df13aaddb538eba04dfab81619c38531724f210), [`2dbb13b`](https://github.com/TokenOneBR/BaaS-Connector/commit/2dbb13bcdbb8fe2b45eb069059b73e9368905bba), [`42db844`](https://github.com/TokenOneBR/BaaS-Connector/commit/42db84462bb2e2354b5ba261e964abbb021491b6), [`95424e1`](https://github.com/TokenOneBR/BaaS-Connector/commit/95424e116f6ea59b8554178074e45b826f800d00), [`b7109b7`](https://github.com/TokenOneBR/BaaS-Connector/commit/b7109b7f4dd77c2ee26dc9486f593a57d44212b5), [`a866ee3`](https://github.com/TokenOneBR/BaaS-Connector/commit/a866ee3e94d459eb9694b47f7e4e239737188656), [`1ce63e2`](https://github.com/TokenOneBR/BaaS-Connector/commit/1ce63e2c184d95525d2d662d4c39f02cc84fd362), [`9e41ad0`](https://github.com/TokenOneBR/BaaS-Connector/commit/9e41ad0872ad3af5ec6ee557e8c3e4613508ee58), [`a8b2d37`](https://github.com/TokenOneBR/BaaS-Connector/commit/a8b2d3784faf4ef9223cbdb9e178e2c39dbd0bf2), [`8cdc13b`](https://github.com/TokenOneBR/BaaS-Connector/commit/8cdc13b88ba5c91112fcd22f549aa7f0cf73b9d9)]:
  - @baasconn/taxonomy@0.2.0
  - @baasconn/provider-spi@0.2.0
