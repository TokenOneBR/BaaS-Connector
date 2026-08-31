# BaaS Connector

**Um conector padrão, open source, para os BaaS brasileiros.** Uma API
canônica, uma taxonomia de referência, e cada provedor como um adapter
plugável — mais um **Mock Bank** com ledger de partidas dobradas real, para
você testar sem sandbox de ninguém.

[![Licença](https://img.shields.io/badge/licen%C3%A7a-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-22-green.svg)](.nvmrc)

---

## Testar em 2 minutos

Precisa apenas de **Node 22** e **pnpm**. Sem Docker, sem banco, sem nada.

```bash
git clone https://github.com/TokenOneBR/BaaS-Connector.git
cd BaaS-Connector
corepack enable
pnpm install
pnpm build
pnpm demo
```

O `pnpm demo` sobe **Mock Bank + API + console** num processo só e imprime
tudo que você precisa:

```
  Console      http://localhost:3000
  API          http://localhost:3001/v1
  Mock Bank    http://localhost:3002
  OpenAPI      http://localhost:3001/docs/v1

  Entrar no console:
    e-mail     admin@local.test
    senha      baas-connector-demo

  API key (header Authorization: Bearer):
    bck_hml_key_01M19T...

  Segredo de assinatura (só as rotas de dinheiro exigem):
    segredo-de-assinatura-do-e2e

    código agora   257572   (expira em até 30s)
    segredo        3ZUAB2QJVLUD6VSEU6UA3EWD6JQ4JEDA
```

> **Os dados ficam em memória.** Nada sobrevive a um restart. Para
> persistência de verdade, veja [Stack completa](#stack-completa).

### Ver o fluxo do dinheiro rodando

Noutro terminal, com o `pnpm demo` de pé:

```bash
export BAAS_API_KEY='cole a API key aqui'
export BAAS_SIGNING_SECRET='cole o segredo de assinatura aqui'

node examples/fluxo-completo.mjs
```

```
conta pagadora   acc_01M19TEJVVB1AGEJBJ0N8ND5X9  ACTIVE
conta recebedora acc_01M19TEJZBZJD7XM1QB3JF2249  chave EMAIL registrada
chave EVP        fec4f0b8-9a33-450b-9f36-d815d772fcc6
saldo            R$ 1500.00
PIX out          txn_01M19TEP3FE9KX100SHQ36Q8D0  PROCESSING
saldo            R$ 1000.00
acima do saldo   422 INSUFFICIENT_FUNDS

Fluxo completo.
```

Isso exercitou: conta PJ criada → onboarding aprovado **por webhook** → chave
PIX registrada → PIX de entrada creditado → PIX de saída debitado → e uma
transferência acima do saldo recusada **antes** de qualquer chamada ao
provedor, pelo ledger sombra.

Leia [`examples/fluxo-completo.mjs`](examples/fluxo-completo.mjs) — são 140
linhas comentadas.

### Ver pelo console

Abra <http://localhost:3000>, entre com o e-mail e a senha acima, e o código
de 6 dígitos que o demo imprimiu.

> O console pede 2FA porque o papel `OWNER` **exige** — e a regra vale também
> no demo. Se o código expirar, adicione o `segredo` ao seu autenticador
> (Google Authenticator, Authy, 1Password) usando o link `otpauth://` que o
> demo imprime.

Dá para navegar por contas, transações, conciliação, provedores, webhooks e
auditoria. Na tela **Mock Bank** você injeta um PIX de entrada, força uma
decisão de onboarding, liga injeção de falha e avança o relógio lógico.

### Cenários do Mock Bank

O comportamento é **função pura do documento** — os dois últimos dígitos
decidem. Nenhum teste precisa mexer em estado:

| CNPJ terminado em | O que acontece |
|---|---|
| `…81` | Aprova (é o do exemplo) |
| `…01` | Pede selfie e comprovante de endereço |
| `…03` | Casa lista de sanções e recusa |
| `…00` | Recusa por divergência com a Receita |

E nos **centavos** do PIX de saída:

| Centavos | O que acontece |
|---|---|
| `,13` | `INSUFFICIENT_FUNDS` |
| `,51` | Erro 500 do provedor |
| `,29` | Timeout — exercita `UNKNOWN` e a conciliação |
| `,44` | Liquida e devolve sozinho após 5s |
| `,07` | Webhook entregue **duas vezes** (teste de dedupe) |
| `,08` | Webhook **fora de ordem** |

---

## Stack completa

Quando quiser persistência de verdade — Postgres, Redis, worker, filas — e
para guardar a credencial de um **provedor real**:

```bash
pnpm up      # postgres, redis, migrate, seed, mock-bank, api, worker, console
```

Requer Docker. O `pnpm up` gera as chaves JWT, sobe tudo, aplica as migrations
e **semeia** o primeiro usuário do console, a conexão do Mock Bank e uma API
key — imprimindo as credenciais no fim.

```bash
pnpm down    # derruba e apaga os volumes
```

### Numa EC2, para testar de qualquer lugar

Uma instância roda o stack inteiro por ~US$ 12/mês — ou ~US$ 0,02/h se você
ligar só para testar. O `deploy/aws/user-data.sh` sobe tudo no boot, gera os
segredos na instância e imprime as credenciais.

Ver [`deploy/aws/README.md`](deploy/aws/README.md).

> **Ainda não construímos essas imagens num ambiente com rede aberta.** O
> caminho `pnpm demo` acima é o que está verificado ponta a ponta. Se o
> `pnpm up` falhar para você, [abra uma issue][issues] com o log — é a
> informação que falta para fechá-lo.

---

## Ligar um provedor real

Depois de `pnpm up`, no console → **Provedores** → nova conexão.

A **credencial é write-only**: depois de salva, nenhuma rota do produto a
devolve. O console mostra `••••••••` mais os quatro últimos caracteres de um
campo que o adapter declara exibível — um identificador, nunca um segredo.

### Woovi

Precisa apenas do **AppID** (painel Woovi → API/Integrações).

> ### ⚠️ Leia antes de cadastrar
>
> **A Woovi não tem sandbox separado.** Os dois ambientes apontam para hosts
> de produção (`api.openpix.com.br` e `api.woovi.com`) — quem separa teste de
> produção é o **AppID**, não a URL. Cadastrar um AppID de produção em
> "HOMOLOGACAO" **cria cobranças reais que alguém pode pagar.**

O que o adapter faz hoje — e só isso:

| Capacidade | Estado |
|---|---|
| Criar cobrança dinâmica | ✅ |
| Consultar cobrança | ✅ |
| Listar cobranças | ✅ |
| Todo o resto (contas, saldo, PIX out, chaves, webhooks) | ❌ 501 |

Um ciclo de teste completo sem webhook: **crie** uma cobrança, pegue o BR
Code, **pague** pelo celular, e **consulte** a cobrança até virar `COMPLETED`.

As fixtures da Woovi são `handcrafted-from-docs` — escritas a partir da
documentação pública, **nunca gravadas contra a API real**. O
[relatório de conformidade](docs/providers/capability-matrix.md) publica essa
distinção de propósito.

---

## Como funciona

```
                  ┌──────────────────────────────┐
   sua aplicação  │   API canônica  /v1          │   console web
   ──────────────▶│   uma taxonomia, um contrato │◀────────────────
                  └──────────────┬───────────────┘
                                 │  Provider SPI
      ┌──────────┬───────────┬───┴───┬──────────┬───────────┐
      ▼          ▼           ▼       ▼          ▼           ▼
   Celcoin    QI Tech      Dock    Asaas      Woovi    Mock Bank
                                                       (ledger real)
```

Você escreve contra **uma** API. Trocar de provedor é mudar uma configuração,
não reescrever a integração.

Três decisões que definem o projeto:

**O ambiente é propriedade da chave.** Uma chave `bck_hml_*` só alcança
homologação; `bck_prd_*`, só produção. Não existe header `X-Environment` nem
parâmetro `environment` — um deles estaria a um typo de uma transferência
real.

**O desfecho desconhecido é um estado, não um erro.** Quando a chamada ao
provedor dá timeout, não sabemos se o dinheiro se moveu. A transação vai para
`UNKNOWN`, o ledger sombra **mantém o hold**, e a API responde `202` — nunca
500, porque 500 convida ao retry que precisamos evitar.

**Nenhum adapter promete o que não faz.** Uma capacidade não declarada devolve
`501` **antes de qualquer chamada de rede**, com a nota do manifesto no corpo.
A [matriz de capacidades](docs/providers/capability-matrix.md) é gerada dos
manifestos e mostra as lacunas honestamente.

---

## Estado atual

| Provedor | Estado |
|---|---|
| **Mock Bank** | Completo — contas, onboarding, saldo, chaves, cobranças, PIX in/out, devolução, extrato, webhooks |
| **Celcoin** | Autenticação OAuth2 e fatia de PIX |
| **Woovi** · **Asaas** · **Dock** · **QI Tech** | Autenticação real e fatia de PIX; o resto declarado `UNSUPPORTED` |

993 testes, 89 de conformidade, 28 de integração com Redis real, e um fluxo
dourado ponta a ponta. **Zero rede real no CI.**

Ainda **não** existe: gravação de fixtures contra sandbox (`test:record`),
enrolamento self-service de 2FA, e nenhuma release publicada.

---

## Documentação

| | |
|---|---|
| [Dinheiro](docs/taxonomy/money.md) | Por que `bigint`, e nunca `float` |
| [Status](docs/taxonomy/status.md) | Por que `UNKNOWN` é o estado mais importante |
| [Erros](docs/taxonomy/errors.md) | `retryable` **não** é `safeToRetry` |
| [Escrever um adapter](docs/guides/writing-a-provider-adapter.md) | O caminho de contribuição |
| [Decisões de arquitetura](docs/adr/) | 20 ADRs, com o porquê de cada escolha |
| [SDK TypeScript](packages/sdk/README.md) | `@baasconn/sdk` |

---

## Contribuir

Leia [CONTRIBUTING.md](CONTRIBUTING.md). Apache-2.0 com DCO sign-off — sem
CLA. O documento de maior alavancagem é o
[guia do adapter](docs/guides/writing-a-provider-adapter.md): `pnpm new:adapter <slug>`
gera um esqueleto honesto, e a suíte de conformidade cobra cada capacidade que
você declarar.

## Licença

[Apache-2.0](LICENSE).

[issues]: https://github.com/TokenOneBR/BaaS-Connector/issues
