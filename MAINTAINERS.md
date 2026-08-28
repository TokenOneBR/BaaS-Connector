# Mantenedores

| Area | Time | Escopo |
|---|---|---|
| Admins | `@tokenone/baas-admins` | Licenca, governanca, protecao de branch |
| Core | `@tokenone/baas-core` | taxonomy, contracts, provider-spi, ledger, schema |
| Security | `@tokenone/baas-security` | crypto, auth, admin API, workflows |
| Infra | `@tokenone/baas-infra` | Docker, Helm, deploy, observabilidade |
| Mantenedores | `@tokenone/baas-maintainers` | Revisao geral, adapters |

## Adapters

| Adapter | Mantenedor | Situacao |
|---|---|---|
| `mock-bank` | `@tokenone/baas-core` | Completo, referencia do SPI |
| `celcoin` | `@tokenone/baas-maintainers` | Referencia funcional |
| `qitech` | procura-se | Esqueleto |
| `dock` | procura-se | Esqueleto |
| `asaas` | procura-se | Esqueleto |
| `woovi` | procura-se | Esqueleto |

Quer manter um adapter? Ver `docs/guides/writing-a-provider-adapter.md` e
`GOVERNANCE.md`.
