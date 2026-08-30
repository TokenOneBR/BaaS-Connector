# Identificadores

ULID com prefixo, tipo *branded* em TypeScript, `parseId()` em runtime.

```
acc_01JBQ8Z2K3XYZ...
```

## Por que ULID e não UUID v4

Ordenável no tempo, então o insert é *append-mostly* no índice B-tree e não
provoca *page split* a cada linha nova. Auto-descritivo em log e em ticket de
suporte: `acc_...` num stack trace já diz do que se trata.

## Por que prefixo

Passar um `accountId` onde se espera um `transactionId` vira erro de
compilação, e não uma consulta que devolve vazio em produção. Os tipos são
*branded*: `AccountId` e `TransactionId` são strings incompatíveis entre si
mesmo tendo a mesma forma.

| Prefixo | Recurso | Prefixo | Recurso |
|---|---|---|---|
| `acc` | Conta | `hld` | Titular |
| `onb` | Caso de onboarding | `req` | Pendência |
| `scr` | Triagem PLD | `doc` | Documento |
| `pky` | Chave PIX | `chg` | Cobrança |
| `txn` | Transação | `evt` | Evento |
| `lac` | Conta do razão | `ltx` | Transação do razão |
| `len` | Lançamento | `rec` | Execução de conciliação |
| `rci` | Item de conciliação | `key` | API key |
| `con` | Conexão de provedor | `opr` | Operação |

## Três espaços de identificador

Todos indexados, e a distinção é o que torna a conciliação possível:

| Espaço | Campo | Quem cunha | Exposto |
|---|---|---|---|
| Conector | `id` | Nós | Sim, imutável |
| Provedor | `providerXxxId` | O BaaS | Sim, opaco |
| Externo | `externalId` | O cliente | Sim, único por ambiente |

## E2EID

Gerado pelo **PSP do pagador**. Nós nunca fabricamos — a única exceção é o
Mock Bank, que legitimamente *é* um PSP.

Fica **nulo na criação** e só aparece em `PROCESSING` ou `SETTLED`. É a
pegadinha clássica: um adapter que exige o E2EID na resposta do `POST` funciona
no provedor que o devolve cedo e quebra no que não devolve.

Índice único parcial `(environment, endToEndId) WHERE NOT NULL` — é a chave de
idempotência de último recurso para webhooks.

Devolução tem `returnId` próprio (prefixo `D`) e referencia
`originalEndToEndId`. A janela de 90 dias e a regra `Σ devoluções ≤ original`
são validadas em política canônica, uma vez, e não em cada adapter.
