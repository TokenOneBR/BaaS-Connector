# @baasconn/adapter-mock-bank

## 0.2.0

### Minor Changes

- [`2df13aa`](https://github.com/TokenOneBR/BaaS-Connector/commit/2df13aaddb538eba04dfab81619c38531724f210) Thanks [@claude](https://github.com/claude)! - Primeiro adapter de provedor: o Mock Bank, implementado por inteiro contra o
  SPI facetado.

  - `adapter-mock-bank`: contas, onboarding, saldo, chaves PIX, cobrancas, PIX
    in/out, devolucao, extrato e webhooks, com manifesto honesto (EMULATED e
    PARTIAL onde o provedor nao entrega o comportamento pleno) e conformidade
    verde nos 10 grupos.
  - `conformance`: corrige o grupo da matriz de erros, que servia as fixtures
    felizes e as de erro no mesmo servidor — a resposta 200 casava primeiro em
    toda rota que os dois conjuntos cobriam, entao a fixture de erro nunca era
    alcancada e o teste passava sem exercitar nada.
  - `taxonomy`: novo `PROVIDER_INTERNAL_ERROR` (502). Nao havia codigo para
    "o servidor do provedor falhou" — o unico destino era `PROVIDER_REJECTED`,
    que e o fallback da tabela de mapeamento e portanto reprovado pela
    conformidade.

- [`9e41ad0`](https://github.com/TokenOneBR/BaaS-Connector/commit/9e41ad0872ad3af5ec6ee557e8c3e4613508ee58) Thanks [@claude](https://github.com/claude)! - Extrato do SPI passa a carregar saldo de abertura e de fechamento, e o Mock
  Bank pagina de verdade.

  Os saldos sao OPCIONAIS de proposito. Exigi-los obrigaria todo adapter a
  devolver um numero mesmo sem ter como calcula-lo, e o caminho de menor esforco
  seria repetir o saldo atual. Um saldo ausente a conciliacao declara como passe
  pulado; um saldo inventado ela acredita, e passa a abrir quebra de saldo em
  cima de ficcao.

  Opcionais no SPI, obrigatoriamente coerentes na conformidade: o grupo 11 novo
  cobra que `abertura + Σ(creditos − debitos da janela) = fechamento` feche, e
  que paginar termine sem repetir cursor nem linha. Os dois saldos precisam vir
  de fontes independentes — o razao e as linhas — senao a assercao vira
  tautologia.

  A tarifa vira linha propria de extrato, com `StatementEntryType.FEE`. O razao
  debita `valor + tarifa` da conta do cliente; sem a linha, a soma nao bate com a
  variacao de saldo em toda conta que paga tarifa.

  Ver ADR 0016.

### Patch Changes

- Updated dependencies [[`2df13aa`](https://github.com/TokenOneBR/BaaS-Connector/commit/2df13aaddb538eba04dfab81619c38531724f210), [`2dbb13b`](https://github.com/TokenOneBR/BaaS-Connector/commit/2dbb13bcdbb8fe2b45eb069059b73e9368905bba), [`01bd80a`](https://github.com/TokenOneBR/BaaS-Connector/commit/01bd80ac614ca5c6e23278df0aee116f932f6e56), [`42db844`](https://github.com/TokenOneBR/BaaS-Connector/commit/42db84462bb2e2354b5ba261e964abbb021491b6), [`95424e1`](https://github.com/TokenOneBR/BaaS-Connector/commit/95424e116f6ea59b8554178074e45b826f800d00), [`b7109b7`](https://github.com/TokenOneBR/BaaS-Connector/commit/b7109b7f4dd77c2ee26dc9486f593a57d44212b5), [`a866ee3`](https://github.com/TokenOneBR/BaaS-Connector/commit/a866ee3e94d459eb9694b47f7e4e239737188656), [`1ce63e2`](https://github.com/TokenOneBR/BaaS-Connector/commit/1ce63e2c184d95525d2d662d4c39f02cc84fd362), [`9e41ad0`](https://github.com/TokenOneBR/BaaS-Connector/commit/9e41ad0872ad3af5ec6ee557e8c3e4613508ee58), [`a8b2d37`](https://github.com/TokenOneBR/BaaS-Connector/commit/a8b2d3784faf4ef9223cbdb9e178e2c39dbd0bf2), [`8cdc13b`](https://github.com/TokenOneBR/BaaS-Connector/commit/8cdc13b88ba5c91112fcd22f549aa7f0cf73b9d9)]:
  - @baasconn/taxonomy@0.2.0
  - @baasconn/provider-spi@0.2.0
  - @baasconn/adapter-kit@0.2.0
