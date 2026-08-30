# BaaS Connector

**Um conector padrão, open source, para os BaaS brasileiros.** Uma API
canônica, uma taxonomia de referência, e cada provedor como um adapter
plugável — mais um Mock Bank com ledger de partidas dobradas real para testar
sem sandbox.

[![Licença](https://img.shields.io/badge/licen%C3%A7a-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-22-green.svg)](.nvmrc)

> Leia também: [README em inglês](README.en.md) · [Documentação](https://docs.baas-connector.dev) · [ADRs](docs/adr/)

---

## O problema

Integrar com cada BaaS brasileiro significa hoje escrever e manter uma
integração dedicada por provedor: contratos, autenticação, webhooks, códigos de
erro e semântica de PIX todos diferentes. Trocar de provedor, operar
multi-provedor ou testar sem sandbox é caro e arriscado.

## A proposta

```
                  ┌─────────────────────────────┐
   sua aplicação  │   API canônica  /v1         │   console web
   ──────────────▶│   uma taxonomia, um contrato │◀────────────────
                  └──────────────┬──────────────┘
                                 │  Provider SPI
      ┌──────────┬───────────┬───┴───┬──────────┬───────────┐
      ▼          ▼           ▼       ▼          ▼           ▼
   Celcoin    QI Tech      Dock    Asaas      Woovi    Mock Bank
                                                       (ledger real)
```

Você escreve contra **uma** API. Trocar de provedor é mudar uma configuração,
não reescrever a integração.

## Estado atual

Este projeto está em desenvolvimento inicial (`0.x`). A matriz abaixo é gerada
a partir dos manifestos de capacidade dos adapters — ela nunca promete mais do
que está implementado.

| Capacidade | Mock Bank | Celcoin | QI Tech | Dock | Asaas | Woovi |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Subconta PF | — | — | — | — | — | — |
| Subconta PJ | — | — | — | — | — | — |
| Onboarding / KYC / KYB | — | — | — | — | — | — |
| Consulta de saldo | — | — | — | — | — | — |
| Chaves PIX | — | — | — | — | — | — |
| PIX in | — | — | — | — | — | — |
| PIX out | — | — | — | — | — | — |
| Devolução | — | — | — | — | — | — |

<!-- gerada por scripts/gen-capability-matrix.ts -->

## Começando

Requer Node 22, pnpm 10 e Docker.

```bash
corepack enable
pnpm install
pnpm up          # postgres, redis, mock-bank, api, worker, console
```

- API canônica: http://localhost:3001/v1
- Console: http://localhost:3000
- Mock Bank: http://localhost:3002
- OpenAPI: http://localhost:3001/docs/v1
- Documentacao: `pnpm docs`

O ambiente sobe já configurado com o **Mock Bank**, então você consegue criar
uma conta, receber um PIX e enviar outro sem credencial de nenhum provedor
real.

## O que o conector faz

- **Subcontas PF e PJ** com onboarding, KYC, KYB e triagem PLD/AML — incluindo
  a árvore de representantes e beneficiários finais que uma PJ brasileira
  realmente tem.
- **Consulta de saldo** com cache e uma regra explícita de quando o cache é
  ignorado (toda leitura declara sua própria frescura).
- **PIX in e PIX out**, chaves, cobranças estática e dinâmica, devolução, com
  codec próprio de BR Code / EMV.
- **Idempotência de ponta a ponta**, incluindo o caso que a maioria das
  integrações omite: o timeout cujo desfecho é desconhecido.
- **Trilha de auditoria** append-only com cadeia de hash verificável.
- **Conciliação** comparando três fontes — provedor, nossos registros e o
  ledger sombra.
- **Ambientes de homologação e produção** amarrados à chave de API, não a um
  header.

## Decisões que valem conhecer antes de usar

- **Dinheiro é `bigint` em centavos**, em toda parte. No wire vai como
  `{ "amount": "1050", "currency": "BRL", "scale": 2 }` — nunca `"10.50"`,
  porque decimal convida `parseFloat` em todo consumidor.
- **O ambiente é propriedade da chave de API**, não um header. Um header de
  ambiente está a um typo de uma transferência PIX real.
- **O conector nunca custodia recurso.** O provedor é o sistema de registro; o
  ledger do conector é sombra, para conciliação e auditoria.
- **Nenhum endpoint devolve credencial de provedor**, nem mascarada. A leitura
  retorna fingerprint e últimos 4.

Cada uma dessas tem um [ADR](docs/adr/) com as alternativas descartadas.

## Arquitetura

| Componente | O que é |
|---|---|
| `apps/api` | API canônica `/v1` + Admin API `/admin/v1` (NestJS) |
| `apps/worker` | Webhooks, outbox, projeção de ledger, conciliação (BullMQ) |
| `apps/mock-bank` | BaaS falso com ledger autoritativo, injeção de falha e relógio controlável |
| `apps/web` | Console: API keys, dashboard, contas, extrato, conciliação (Next.js) |
| `packages/taxonomy` | Vocabulário canônico: enums, Money, IDs, FSM, erros, EMV |
| `packages/contracts` | DTOs em Zod — fonte única de validação, tipos e OpenAPI |
| `packages/provider-spi` | O contrato que todo adapter implementa |
| `packages/adapter-kit` | HTTP, retry, breaker, OAuth, assinatura, redação |
| `packages/conformance` | A suíte que todo adapter precisa passar |
| `packages/ledger` | Motor de partidas dobradas em duas fases |

## Documentação

| Documento | O que cobre |
|---|---|
| [Fluxos de dinheiro](docs/guides/money-flows.md) | Saldo e cache, chaves, cobranças, Pix in/out, devolução e extrato — com o porquê de cada ordem |
| [Escrevendo um adapter](docs/guides/writing-a-provider-adapter.md) | Do `pnpm new:adapter` até a conformidade verde |
| [Gravando fixtures](docs/guides/recording-fixtures.md) | Como capturar e limpar cassetes |
| [Desenvolvimento local](docs/guides/local-development.md) | Subir a stack e rodar a suíte |
| [Matriz de capacidades](docs/providers/capability-matrix.md) | O que cada provedor suporta, gerado dos manifestos |
| [ADRs](docs/adr/README.md) | As decisões estruturais e o que foi rejeitado |

## Contribuindo

O caminho de maior valor é **completar um adapter**. Comece por
[docs/guides/writing-a-provider-adapter.md](docs/guides/writing-a-provider-adapter.md).

Leia [CONTRIBUTING.md](CONTRIBUTING.md) para setup, DCO e o que o CI cobra.
Governança e como ela é imposta tecnicamente estão em
[GOVERNANCE.md](GOVERNANCE.md).

## Licença

[Apache-2.0](LICENSE). O uso das marcas é regido por
[TRADEMARKS.md](TRADEMARKS.md).

Celcoin, QI Tech, Dock, Asaas e Woovi são marcas de seus respectivos
titulares. Este projeto não é afiliado a nenhuma delas; os adapters existem
para interoperabilidade e foram escritos a partir de documentação pública.
