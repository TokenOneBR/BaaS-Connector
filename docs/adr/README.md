# Architecture Decision Records

Decisoes de arquitetura, com o **porque** registrado. Um ADR nao e
documentacao de como usar; e o registro de uma escolha e das alternativas
descartadas, para que a discussao nao se repita em seis meses.

Mudanca em `taxonomy`, `contracts` ou `provider-spi` exige ADR **antes** do PR
de implementacao. Ver [GOVERNANCE.md](../../GOVERNANCE.md).

| # | Decisao |
|---|---|
| [0001](0001-monorepo-pnpm-turborepo.md) | pnpm workspaces + Turborepo |
| [0002](0002-taxonomy-contracts-split.md) | Separar `taxonomy` de `contracts` |
| [0003](0003-provider-spi-capabilities.md) | SPI facetado com manifesto de capacidades |
| [0004](0004-mock-bank-standalone.md) | Mock Bank como servico autonomo |
| [0005](0005-double-entry-ledger.md) | Ledger de partidas dobradas em duas fases |
| [0006](0006-admin-api-separate.md) | Admin API separada da API publica |
| [0007](0007-vitest-over-jest.md) | Vitest em todo o repositorio |
| [0008](0008-cassettes-over-live-sandbox.md) | Fixtures gravadas, sem sandbox no CI |
| [0009](0009-credential-envelope-encryption.md) | Credenciais cifradas em envelope no Postgres |
| [0010](0010-idempotency-and-outbox.md) | Idempotencia em duas camadas e outbox |
| [0011](0011-apache-2-0-and-dco.md) | Apache-2.0 com DCO |
| [0012](0012-changesets-for-release.md) | Changesets para release |
| [0013](0013-console-session-model.md) | Sessao do console: JWT assimetrico e refresh rotativo |
| [0014](0014-shadow-ledger-customer-side-only.md) | Ledger sombra espelha so o lado do cliente |

Novo ADR: copie [0000-template.md](0000-template.md).
