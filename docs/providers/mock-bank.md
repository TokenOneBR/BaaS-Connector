# Mock Bank

Um BaaS **falso** com ledger de partidas dobradas real, para desenvolver e
testar sem credencial de provedor nenhum.

> **Nunca exponha na internet nem habilite em produção.** Os endpoints
> `_control` não têm autenticação forte — isso é intencional, e o
> [SECURITY.md](../../SECURITY.md) coloca este serviço explicitamente fora do
> escopo de segurança. O chart Helm o mantém desabilitado por padrão.

## Por que existe como serviço, e não como fake em processo

Um fake em processo seria mais rápido nos testes, mas **PIX é assíncrono**. Os
modos de falha que interessam são entrega de webhook, evento fora de ordem,
evento duplicado, liquidação atrasada, timeout e retry — e nenhum deles existe
num fake que responde por chamada de função.

Com o salto HTTP real, o código de timeout, retry, idempotência e circuit
breaker do conector fica no caminho crítico de todo teste ponta a ponta.

Ver [ADR 0004](../adr/0004-mock-bank-standalone.md).

## Subindo

```bash
docker compose up -d mock-bank     # http://localhost:3002
```

Ou standalone:

```bash
pnpm --filter @baasconn/mock-bank dev
```

## Autenticação

OAuth2 client_credentials, como Celcoin e a maioria dos BaaS:

```bash
curl -X POST localhost:3002/api/v1/auth/token \
  -H 'content-type: application/json' \
  -d '{"grant_type":"client_credentials","client_id":"mock-client","client_secret":"mock-secret"}'
```

O token expira contra o **relógio lógico**, então avançar o relógio testa
renovação de token de graça.

## Valores mágicos

O comportamento é **função pura** do documento ou do valor — padrão dos cartões
de teste da Stripe. Nenhum teste precisa mexer em estado do servidor.

`GET /_control/magic` devolve a tabela viva.

### Onboarding — dois últimos dígitos do CPF/CNPJ

| Sufixo | Comportamento |
|---|---|
| `00` | Recusa imediata, `DATA_MISMATCH` |
| `01` | Pede `SELFIE_LIVENESS` e `PROOF_OF_ADDRESS`; aprova quando os dois chegam |
| `02` | Mesa de análise, aprova após o atraso configurado |
| `03` | Screening de sanções casa → recusa |
| `04` | Screening PEP casa → análise manual |
| `05` | Expira em 60 s sem documento |
| `06` | Aprova, mas a conta abre **bloqueada** |
| outros | Aprova |

Documentos sintéticos com dígito verificador válido, gerados para este repositório:

| Cenário | CPF |
|---|---|
| Aprova | `52998224725` |
| Recusa (`00`) | `10433218100` |
| Pendências (`01`) | `58692322601` |
| Análise (`02`) | `95134332002` |
| Sanções (`03`) | `08412411803` |
| Abre bloqueada (`06`) | `16934060806` |

CNPJ que aprova: `11222333000181`.

### Enviando documentos

O cenário `01` se resolve pela API pública, não só pelo painel de controle:

```
POST /api/v1/contas/:id/onboarding/documentos?codigo=SELFIE_LIVENESS
Content-Type: application/octet-stream
X-Conteudo-Sha256: <hex opcional>

<bytes do arquivo>
```

Os bytes vão crus, não em base64 dentro de JSON: um RG fotografado passa fácil
de 10 MB, e base64 o infla em um terço antes de o parser sequer decidir se
aceita. Teto de 20 MiB, aplicado durante o stream.

Se `X-Conteudo-Sha256` vier, o Mock Bank confere e recusa divergência com
`MB-DOC-422`. Um upload truncado por rede instável é indistinguível de um
arquivo legítimo sem essa checagem, e o resultado seria uma pendência
"cumprida" com metade de um documento.

Resposta:

```json
{
  "documento_id": "doc_01J...",
  "codigo": "SELFIE_LIVENESS",
  "situacao": "ACEITO",
  "sha256": "9f2c...",
  "tamanho_bytes": 21,
  "onboarding": { "situacao": "PENDING_REQUIREMENTS", "pendencias": [...] }
}
```

Cumprir a última pendência aprova o caso e abre a conta, emitindo
`onboarding.status_changed` e `account.status_changed`. O conteúdo **não é
guardado** — um banco de mentira não precisa reter PDF de KYC, e guardá-lo em
memória transformaria a suíte e2e num consumidor de heap. Fica só o que o
conector precisa conferir: tamanho e digest.

### PIX out — dois últimos dígitos dos centavos

| Centavos | Comportamento |
|---|---|
| `,13` | `INSUFFICIENT_FUNDS`, mesmo havendo saldo |
| `,51` | 500 do provedor |
| `,29` | **Não responde** — exercita o caminho de desfecho desconhecido |
| `,44` | Liquida e devolve automaticamente após 5 s |
| `,07` | Liquida, webhook entregue **duas vezes** |
| `,08` | Liquida, webhook de liquidação chega **antes** do de pendente |
| outros | Liquida normalmente |

O `,29` é o mais valioso: é o cenário que a maioria das integrações nunca testa
e o que produz pagamento duplo em produção.

## Painel de controle

| Rota | O que faz |
|---|---|
| `POST /_control/webhook-url` | Registra para onde entregar os webhooks |
| `GET /_control/webhooks` | Log de entregas — permite afirmar que a segunda entrega aconteceu |
| `POST /_control/faults` | Latência, taxa de erro, status forçado, webhook duplicado/fora de ordem, assinatura inválida |
| `POST /_control/clock/advance` | Avança o relógio lógico (`{days: 91}` testa a janela de devolução sem esperar) |
| `POST /_control/pix/inbound` | Injeta um PIX de entrada |
| `POST /_control/pix/pay-charge` | Paga uma cobrança, como quem lê o QR |
| `POST /_control/onboarding/decide` | Força aprovação, recusa ou pendência |
| `POST /_control/forget-transaction` | Faz o banco "esquecer" uma transação — produz `MISSING_ON_PROVIDER` determinístico |
| `GET /_control/ledger/verify` | Afirma que débitos igualam créditos no razão inteiro |
| `POST /_control/reset` | Zera tudo |

Também dá para forçar cenário por requisição, sem mudar a configuração global:

```bash
curl localhost:3002/api/v1/contas -H 'X-Mock-Scenario: rate-limited'   # 429
curl localhost:3002/api/v1/contas -H 'X-Mock-Scenario: slow'           # 5 s
```

## O ledger é real

Toda movimentação passa por partidas dobradas em duas fases. Um PIX out reserva
o saldo na autorização e efetiva na liquidação, exatamente como no SPI — é isso
que faz o conector exercitar o caminho pendente/liquidado em vez de assumir que
pagamento é atômico.

`GET /_control/ledger/verify` verifica as invariantes: cada transação balanceia,
o razão inteiro soma zero, os contadores materializados batem com os lançamentos
e nenhuma conta sem permissão está negativa.

O teste de 200 PIX-outs concorrentes contra saldo para exatamente 100 liquida
100 e recusa 100, pelo HTTP real.

## Timeout configurável

O cenário de desfecho desconhecido (centavos `,29`) simplesmente **não
responde** — é o ponto dele. Com os timeouts padrão do kit, cada teste que o
exercita esperaria 10 segundos por cabeçalhos.

Por isso — e **só** neste adapter, porque só ele tem um cenário que trava de
propósito — a conexão aceita `config.requestTimeoutMs`:

```jsonc
{
  "baseUrl": "http://localhost:3002",
  "config": { "requestTimeoutMs": 1500 }
}
```

## Formato do wire

Deliberadamente **não** igual ao canônico: valores em decimal string, status em
português, `snake_case`. É o que força o adapter a existir e a fazer mapeamento
de verdade, em vez de repassar o payload.

```jsonc
// GET /api/v1/contas/:id/saldo
{
  "saldo_disponivel": "1500.00",
  "saldo_bloqueado": "0.00",
  "moeda": "BRL"
}
```
