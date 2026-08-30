# Matriz de capacidades

<!-- GERADO AUTOMATICAMENTE por scripts/gen-capability-matrix.ts. Nao edite. -->

Esta tabela vem dos `CapabilityDescriptor` dos adapters, entao ela nunca
promete mais do que o codigo entrega. A suite de conformidade verifica os dois
sentidos: capacidade declarada como suportada precisa funcionar, e capacidade
declarada como nao suportada precisa devolver `CapabilityNotSupportedError`.

**Legenda:** `sim` nativo · `parcial` com restricoes (ver nota) ·
`emulado` sintetizado pelo conector · `-` nao suportado (devolve 501).

### Contas

| Capacidade | Mock Bank |
|---|:---:|
| `accounts.create.pf` | sim |
| `accounts.create.pj` | sim |
| `accounts.get` | sim |
| `accounts.list` | parcial[^accounts.list-MOCK_BANK] |
| `accounts.updateStatus` | sim |
| `accounts.close` | sim |

### Onboarding e compliance

| Capacidade | Mock Bank |
|---|:---:|
| `onboarding.kyc.submit` | emulado[^onboarding.kyc.submit-MOCK_BANK] |
| `onboarding.kyb.submit` | emulado[^onboarding.kyb.submit-MOCK_BANK] |
| `onboarding.status.get` | sim |
| `onboarding.document.upload` | sim |
| `onboarding.requirements.list` | sim |
| `onboarding.requirements.fulfill` | emulado[^onboarding.requirements.fulfill-MOCK_BANK] |
| `onboarding.pld.screening` | - |

### Saldo

| Capacidade | Mock Bank |
|---|:---:|
| `balance.get` | sim |
| `balance.blocked` | sim |

### Chaves PIX

| Capacidade | Mock Bank |
|---|:---:|
| `pix.keys.create` | sim |
| `pix.keys.list` | sim |
| `pix.keys.delete` | sim |
| `pix.keys.claim` | - |
| `pix.keys.resolve` | sim |

### Cobrancas PIX

| Capacidade | Mock Bank |
|---|:---:|
| `pix.charge.static.create` | sim |
| `pix.charge.dynamic.create` | sim |
| `pix.charge.dynamic.update` | - |
| `pix.charge.get` | sim |
| `pix.charge.list` | parcial[^pix.charge.list-MOCK_BANK] |
| `pix.charge.cancel` | sim |

### Movimentacao PIX

| Capacidade | Mock Bank |
|---|:---:|
| `pix.in.receive` | sim |
| `pix.out.send` | sim[^pix.out.send-MOCK_BANK] |
| `pix.out.scheduled` | - |
| `pix.transaction.get` | sim |
| `pix.refund.create` | sim |
| `pix.refund.get` | sim |

### Extrato

| Capacidade | Mock Bank |
|---|:---:|
| `statement.list` | sim[^statement.list-MOCK_BANK] |
| `statement.export` | - |

### Infraestrutura

| Capacidade | Mock Bank |
|---|:---:|
| `webhooks.inbound` | sim |
| `webhooks.signature.verify` | sim[^webhooks.signature.verify-MOCK_BANK] |

## Notas

[^accounts.list-MOCK_BANK]: **Mock Bank** — Devolve todas as contas do cliente de uma vez, sem cursor. hasMore e sempre false.
[^onboarding.kyc.submit-MOCK_BANK]: **Mock Bank** — O caso e criado implicitamente na abertura da conta; nao ha rota de submissao. A chamada le o caso existente em vez de criar um.
[^onboarding.kyb.submit-MOCK_BANK]: **Mock Bank** — O caso e criado implicitamente na abertura da conta; nao ha rota de submissao. A chamada le o caso existente em vez de criar um.
[^onboarding.requirements.fulfill-MOCK_BANK]: **Mock Bank** — A pendencia e cumprida pelo envio do documento; nao ha rota dedicada. A chamada apenas rele o caso.
[^pix.charge.list-MOCK_BANK]: **Mock Bank** — Sem cursor e sem filtro de periodo: devolve todas as cobrancas da conta.
[^pix.out.send-MOCK_BANK]: **Mock Bank** — Aceita destino por chave PIX ou por dados bancarios. Copia e cola precisa ser parseado antes; o Mock Bank nao recebe EMV no envio.
[^statement.list-MOCK_BANK]: **Mock Bank** — Cursor de keyset por (liquidacao, id). Devolve saldo de abertura e de fechamento.
[^webhooks.signature.verify-MOCK_BANK]: **Mock Bank** — HMAC-SHA256 sobre "<timestamp>.<corpo cru>", no esquema da Stripe.
[^reconciliation.statement.pull-MOCK_BANK]: **Mock Bank** — Mesma rota de extrato, com os saldos que fecham o passe de conferencia de saldo.
