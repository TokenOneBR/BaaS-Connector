# @baasconn/conformance

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

- Updated dependencies [[`2df13aa`](https://github.com/TokenOneBR/BaaS-Connector/commit/2df13aaddb538eba04dfab81619c38531724f210), [`2dbb13b`](https://github.com/TokenOneBR/BaaS-Connector/commit/2dbb13bcdbb8fe2b45eb069059b73e9368905bba), [`01bd80a`](https://github.com/TokenOneBR/BaaS-Connector/commit/01bd80ac614ca5c6e23278df0aee116f932f6e56), [`b8b8301`](https://github.com/TokenOneBR/BaaS-Connector/commit/b8b8301bbff863ae6d49fb2414eb1360667f099c), [`02efbd4`](https://github.com/TokenOneBR/BaaS-Connector/commit/02efbd4bb6d516d31ccdcb1f92028fe6d3ea66bf), [`e706a6b`](https://github.com/TokenOneBR/BaaS-Connector/commit/e706a6b0ab160315e522c4ec8d90f1dfc347453e), [`42db844`](https://github.com/TokenOneBR/BaaS-Connector/commit/42db84462bb2e2354b5ba261e964abbb021491b6), [`95424e1`](https://github.com/TokenOneBR/BaaS-Connector/commit/95424e116f6ea59b8554178074e45b826f800d00), [`b7109b7`](https://github.com/TokenOneBR/BaaS-Connector/commit/b7109b7f4dd77c2ee26dc9486f593a57d44212b5), [`a866ee3`](https://github.com/TokenOneBR/BaaS-Connector/commit/a866ee3e94d459eb9694b47f7e4e239737188656), [`1ce63e2`](https://github.com/TokenOneBR/BaaS-Connector/commit/1ce63e2c184d95525d2d662d4c39f02cc84fd362), [`9e41ad0`](https://github.com/TokenOneBR/BaaS-Connector/commit/9e41ad0872ad3af5ec6ee557e8c3e4613508ee58), [`a8b2d37`](https://github.com/TokenOneBR/BaaS-Connector/commit/a8b2d3784faf4ef9223cbdb9e178e2c39dbd0bf2), [`8cdc13b`](https://github.com/TokenOneBR/BaaS-Connector/commit/8cdc13b88ba5c91112fcd22f549aa7f0cf73b9d9), [`e706a6b`](https://github.com/TokenOneBR/BaaS-Connector/commit/e706a6b0ab160315e522c4ec8d90f1dfc347453e)]:
  - @baasconn/taxonomy@0.2.0
  - @baasconn/provider-spi@0.2.0
  - @baasconn/adapter-kit@0.2.0
  - @baasconn/contracts@0.2.0
