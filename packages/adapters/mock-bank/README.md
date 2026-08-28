# `@baasconn/adapter-mock-bank`

Adapter do [Mock Bank](../../../docs/providers/mock-bank.md) — o BaaS falso que
acompanha o conector.

Ele existe por dois motivos. O primeiro é permitir testar o conector inteiro sem
credencial de nenhum provedor real. O segundo, e mais importante: **o Mock Bank
é consumido pelo mesmo SPI que a Celcoin**. Se o SPI tivesse vazado alguma
premissa de um provedor específico, este adapter não fecharia — é a melhor prova
disponível de que a interface é agnóstica.

## Capacidades

Geradas a partir do manifesto em [`docs/providers/capability-matrix.md`](../../../docs/providers/capability-matrix.md).
Resumo do que **não** é `SUPPORTED`, com o motivo:

| Capacidade | Nível | Por quê |
|---|---|---|
| `onboarding.kyc.submit`, `onboarding.kyb.submit` | `EMULATED` | O caso é criado implicitamente na abertura da conta; não existe rota de submissão. A chamada lê o caso existente. |
| `onboarding.requirements.fulfill` | `EMULATED` | A pendência é cumprida pelo envio do documento; não há rota dedicada. |
| `accounts.list`, `pix.charge.list`, `statement.list` | `PARTIAL` | Sem cursor: o provedor devolve tudo de uma vez. |
| `onboarding.pld.screening` | `UNSUPPORTED` | As verificações só aparecem dentro do caso, não há consulta avulsa. |
| `pix.keys.claim` | `UNSUPPORTED` | O Mock Bank não simula reivindicação de chave. |
| `pix.charge.dynamic.update` | `UNSUPPORTED` | Cobrança dinâmica não é editável. |
| `pix.out.scheduled` | `UNSUPPORTED` | Sem agendamento. |
| `statement.export` | `UNSUPPORTED` | Sem exportação assíncrona. |

## Peculiaridades

**Dinheiro vem em dois formatos.** O REST devolve decimal (`"1500.00"`); o
webhook devolve centavos como string (`"150000"`). As duas conversões vivem em
`src/mappers/money.ts` com nomes que dizem de onde o valor veio — trocá-las
produz um erro de fator 100 que passa em revisão porque os dois valores parecem
plausíveis.

**Status de conta vem em dois vocabulários.** `situacao` no REST é português
(`ATIVA`, `BLOQUEADA`); o webhook `account.status_changed` carrega o enum inglês
(`ACTIVE`, `BLOCKED`). Transação, cobrança, chave e onboarding usam o inglês nos
dois lugares. A tabela de inversão é explícita e exaustiva: um `default`
otimista transformaria um status novo em `ATIVA` silenciosamente, e uma conta
bloqueada tratada como ativa é uma transferência que não deveria sair.

**O caso de onboarding só é endereçável pela conta.** Não existe
`GET /onboarding/:id`. Como `create(ctx)` roda uma vez por operação lógica, um
índice em memória estaria vazio na chamada seguinte — o bug apareceria só sob
carga. Em vez disso o `providerCaseId` que devolvemos é composto
(`<contaId>~<casoId>`); ele é opaco para o core por contrato, então carregar as
duas partes ali é legítimo e, o que importa, sem estado.

**Contraparte é camelCase dentro de um envelope snake_case**, e `occurredAt` é a
única chave camelCase do envelope de webhook.

**Assinatura de webhook segue o esquema da Stripe**:
`HMAC-SHA256(segredo, "<timestamp>.<corpo cru>")`, no header
`x-mockbank-signature: t=…,v1=…`. A verificação usa os **bytes crus** —
reserializar o JSON muda espaçamento e ordem de chave, e a assinatura deixa de
conferir.

## Fixtures

`source: "sandbox"` — capturadas de execução real do Mock Bank, não escritas a
partir da documentação. A distinção aparece no relatório de conformidade:
fixture manual é uma promessa, fixture gravada é uma observação.

O CNPJ das fixtures tem **dígito verificador inválido de propósito**. Duas
restrições se cruzam: `scripts/check-cassette-pii.ts` reprova documento com
dígito válido (pode ser de uma empresa real), e os sintéticos já no allowlist
são justamente os canários de vazamento do grupo 9 da conformidade. Dígito
inválido satisfaz as duas.

## Rodando

```bash
pnpm --filter @baasconn/adapter-mock-bank test              # mappers + conformidade
pnpm --filter @baasconn/adapter-mock-bank test:conformance  # só a conformidade
```

Nenhum dos dois toca a rede: as fixtures são servidas por um servidor
`node:http` real em porta efêmera.
