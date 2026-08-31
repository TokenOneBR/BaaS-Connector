# @baasconn/adapter-celcoin

## 0.2.0

### Minor Changes

- [`66af419`](https://github.com/TokenOneBR/BaaS-Connector/commit/66af4198c834e136db66ab4818010e804b280637) Thanks [@claude](https://github.com/claude)! - Adiciona o adapter da Celcoin.

  Contas PF e PJ, leitura de proposta de onboarding, saldo, chaves PIX (criar,
  listar, remover, resolver no DICT) e PIX out com consulta por chave de
  idempotência — a rota que a escada de desfecho desconhecido usa como primeira
  tentativa.

  As fixtures são `handcrafted-from-docs`, escritas a partir da documentação
  pública e não gravadas contra o sandbox. A conformidade prova que os mappers
  são coerentes com o que a documentação descreve; não prova que a documentação
  está certa. O manifesto declara `UNSUPPORTED` tudo que não foi possível
  confirmar, e a matriz publicada mostra as lacunas.

  Em `@baasconn/conformance`, as duas verificações que cobram promessas — exigir
  fixture de erro e exigir tráfego para o cassette server — passam a valer só a
  partir da primeira capacidade declarada, para que um esqueleto honesto (que não
  promete nada) não reprove a própria suíte.

### Patch Changes

- Updated dependencies [[`2df13aa`](https://github.com/TokenOneBR/BaaS-Connector/commit/2df13aaddb538eba04dfab81619c38531724f210), [`2dbb13b`](https://github.com/TokenOneBR/BaaS-Connector/commit/2dbb13bcdbb8fe2b45eb069059b73e9368905bba), [`01bd80a`](https://github.com/TokenOneBR/BaaS-Connector/commit/01bd80ac614ca5c6e23278df0aee116f932f6e56), [`42db844`](https://github.com/TokenOneBR/BaaS-Connector/commit/42db84462bb2e2354b5ba261e964abbb021491b6), [`95424e1`](https://github.com/TokenOneBR/BaaS-Connector/commit/95424e116f6ea59b8554178074e45b826f800d00), [`b7109b7`](https://github.com/TokenOneBR/BaaS-Connector/commit/b7109b7f4dd77c2ee26dc9486f593a57d44212b5), [`a866ee3`](https://github.com/TokenOneBR/BaaS-Connector/commit/a866ee3e94d459eb9694b47f7e4e239737188656), [`1ce63e2`](https://github.com/TokenOneBR/BaaS-Connector/commit/1ce63e2c184d95525d2d662d4c39f02cc84fd362), [`9e41ad0`](https://github.com/TokenOneBR/BaaS-Connector/commit/9e41ad0872ad3af5ec6ee557e8c3e4613508ee58), [`a8b2d37`](https://github.com/TokenOneBR/BaaS-Connector/commit/a8b2d3784faf4ef9223cbdb9e178e2c39dbd0bf2), [`8cdc13b`](https://github.com/TokenOneBR/BaaS-Connector/commit/8cdc13b88ba5c91112fcd22f549aa7f0cf73b9d9)]:
  - @baasconn/taxonomy@0.2.0
  - @baasconn/provider-spi@0.2.0
  - @baasconn/adapter-kit@0.2.0
