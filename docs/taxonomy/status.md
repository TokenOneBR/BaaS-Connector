# Status e máquinas de estado

As máquinas vivem em `packages/taxonomy/src/fsm/` como tabelas
`Record<Status, readonly Status[]>`, aplicadas por um único `applyTransition()`
— o mesmo usado pela camada de API e pela ingestão de webhook. Duas
implementações da mesma máquina divergem na primeira mudança.

## `TransactionStatus`

`CREATED` · `PENDING` · `PROCESSING` · `SETTLED` · `FAILED` · `CANCELLED` ·
`REVERSED` · `PARTIALLY_REVERSED` · **`UNKNOWN`**

### `UNKNOWN` é o estado mais importante do modelo

É o que toda integração ingênua omite. Quando a chamada de PIX out dá timeout
de leitura, **não sabemos se o dinheiro se moveu**. A transação vai para
`UNKNOWN`, o razão sombra **mantém o hold**, e um worker consulta o provedor
pela chave de idempotência até resolver.

Nunca reenviamos. Liberar o hold aqui devolveria ao cliente um saldo que talvez
já tenha saído da conta dele no provedor; reenviar pagaria duas vezes.

O cliente recebe **202** com um `operation_id`, e não 500 — um 500 convida ao
retry que precisamos evitar.

### Ranking, e por que `SETTLED` e `FAILED` empatam

O guard de aplicação é monotônico: um evento só avança o status.

```sql
UPDATE transaction SET status = $new, ...
 WHERE id = $id AND status_rank < $newRank
   AND (last_event_at IS NULL OR last_event_at <= $occurredAt);
```

`UNKNOWN` tem rank **0**, abaixo de tudo: qualquer informação concreta o
substitui. `SETTLED` e `FAILED` têm o **mesmo** rank, de propósito — um nunca
sobrescreve o outro só por chegar depois, e um provedor que emite os dois fora
de ordem produz uma anomalia auditada em vez de um estado invertido.

Zero linhas atualizadas significa evento velho ou duplicado: marcado
`DISCARDED` com o motivo (`stale_rank`, `stale_timestamp`, `same_state`), e
mesmo assim com *ack*.

### Transição ilegal não é descartada

Provedores emitem eventos fora de ordem, e ignorar em silêncio é como saldos
derivam. Uma transição que a máquina recusa vira **anomalia auditada**:
`AuditLog` com `outcome: FAILURE`, `OutboxEvent` `anomaly.detected`, e
métrica.

## `AccountStatus`

`DRAFT` · `PENDING_ONBOARDING` · `PENDING_DOCUMENTS` · `UNDER_REVIEW` ·
`ACTIVE` · `BLOCKED` · `SUSPENDED` · `REJECTED` · `CLOSING` · `CLOSED`

`BLOCKED` e `SUSPENDED` são distintos: bloqueio é ação nossa ou judicial sobre
os fundos; suspensão é decisão do provedor sobre a conta.

## `OnboardingStatus`

`DRAFT` · `SUBMITTED` · `PENDING_REQUIREMENTS` · `IN_ANALYSIS` ·
`MANUAL_REVIEW` · `APPROVED` · `REJECTED` · `EXPIRED` · `CANCELLED`

## Enums do Prisma versus enums do domínio

Um teste compara `Object.values()` dos dois. É o que impede o *drift* clássico
entre enum de banco e enum de domínio — o modo de falha é uma migração que
adiciona um valor no Postgres e não no TypeScript, e o sintoma é uma linha que
o código não sabe ler.
