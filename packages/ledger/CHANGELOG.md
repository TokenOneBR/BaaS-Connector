# @baasconn/ledger

## 0.2.0

### Minor Changes

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

- [`34993ce`](https://github.com/TokenOneBR/BaaS-Connector/commit/34993ce30fb65fbe181e394cc84fc4e6d653190a) Thanks [@claude](https://github.com/claude)! - Ajusta a integracao do ledger com o Mock Bank (erro de saldo insuficiente
  expoe o valor disponivel diretamente).
- Updated dependencies [[`2df13aa`](https://github.com/TokenOneBR/BaaS-Connector/commit/2df13aaddb538eba04dfab81619c38531724f210), [`2dbb13b`](https://github.com/TokenOneBR/BaaS-Connector/commit/2dbb13bcdbb8fe2b45eb069059b73e9368905bba), [`42db844`](https://github.com/TokenOneBR/BaaS-Connector/commit/42db84462bb2e2354b5ba261e964abbb021491b6), [`95424e1`](https://github.com/TokenOneBR/BaaS-Connector/commit/95424e116f6ea59b8554178074e45b826f800d00), [`b7109b7`](https://github.com/TokenOneBR/BaaS-Connector/commit/b7109b7f4dd77c2ee26dc9486f593a57d44212b5), [`a8b2d37`](https://github.com/TokenOneBR/BaaS-Connector/commit/a8b2d3784faf4ef9223cbdb9e178e2c39dbd0bf2), [`8cdc13b`](https://github.com/TokenOneBR/BaaS-Connector/commit/8cdc13b88ba5c91112fcd22f549aa7f0cf73b9d9)]:
  - @baasconn/taxonomy@0.2.0
