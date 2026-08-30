# Erros

`BaasErrorCode` é uma lista achatada, com `category`, `httpStatus`,
`retryable` e — separadamente — `safeToRetry`.

## `retryable` e `safeToRetry` não são a mesma coisa

A distinção é deliberada e é o centro do modelo:

| Situação | `retryable` | `safeToRetry` |
|---|---|---|
| Timeout num `GET /v1/accounts/:id` | sim | sim |
| Timeout num `POST /v1/.../pix/transfers` | sim | **só com idempotência no provedor** |
| `422 INSUFFICIENT_FUNDS` | não | não |
| `429` com `Retry-After` | sim | sim |

Um timeout de leitura numa transferência é *transitório* — pode dar certo na
próxima — mas só é *seguro repetir* porque mandamos uma chave de idempotência
ao provedor. Onde o provedor não suporta idempotência, o adapter marca
`safeToRetry: false` e a transação vai para `UNKNOWN`.

## Corpo padrão

```json
{
  "error": {
    "code": "INSUFFICIENT_FUNDS",
    "category": "VALIDATION",
    "message": "Insufficient funds in the account.",
    "message_ptbr": "Saldo insuficiente na conta.",
    "details": [],
    "request_id": "req_01JBQ...",
    "docs_url": "https://docs.baas-connector.dev/errors/INSUFFICIENT_FUNDS",
    "provider": {
      "slug": "CELCOIN",
      "code": "CBE-1234",
      "message": "saldo indisponivel"
    }
  }
}
```

### `message_ptbr` vem de catálogo

Não é tradução automática. O suporte é brasileiro, e uma mensagem gerada por
máquina numa tela de incidente é uma mensagem que ninguém confia.

### `provider` é preservado **literalmente**

O código cru do provedor é o que o time de suporte usa para escalar com o BaaS.
Normalizá-lo perderia exatamente a informação que faz a escalação funcionar.
Pode ser desligado com `EXPOSE_PROVIDER_MESSAGES=false` quando o detalhe de
integração não deve chegar ao cliente final.

## Erros de capacidade

Uma rota cuja capacidade o manifesto declara `UNSUPPORTED` devolve **501**
**antes de qualquer chamada de rede**, com o `note` do manifesto no corpo. Não
é um erro do provedor; é o conector dizendo que aquela conexão não faz aquilo.

`PARTIAL` e `EMULATED` não são erro, mas a resposta carrega
`X-Baas-Capability-Level` e `_meta.capability_notes[]`.

## `ProviderOutcomeUnknownError`

Não chega ao cliente como erro. Vira **202** com `operation_id`. Ver
[status](./status.md#unknown-é-o-estado-mais-importante-do-modelo).
