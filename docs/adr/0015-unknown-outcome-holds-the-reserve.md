# ADR 0015: O desfecho desconhecido mantém a reserva e devolve 202

- **Status:** Aceito
- **Data:** 2026-08-29

## Contexto

Um `POST /pix/transfers` que não responde — timeout de cabeçalhos, conexão
derrubada, o processo do provedor morrendo entre o commit e o `write` — deixa
o conector sem saber se o dinheiro se moveu. Não é um caso raro: é o caso que
toda integração ingênua omite, e é o único em que um erro de tratamento custa
dinheiro em vez de custar uma reclamação.

Três coisas precisam ser decididas juntas, porque uma escolha errada em
qualquer uma delas anula as outras duas: **o que o cliente recebe**, **o que
acontece com a reserva no razão sombra**, e **o que o registro de idempotência
guarda**.

## Decisão

**1. O cliente recebe `202 Accepted` com um `operation_id`.**

Não um 500. Um 5xx é a resposta que instrui todo cliente bem escrito — e todo
SDK gerado — a retentar, e retentar é exatamente o que não pode acontecer. O
202 diz o que de fato sabemos: a operação existe, o dinheiro pode ter saído,
consulte `GET /v1/operations/:id` em vez de reenviar.

**2. A reserva (`PENDING`) no razão sombra é MANTIDA.**

Liberá-la devolveria ao cliente um saldo que talvez já tenha saído da conta
dele no provedor. Ele gastaria o mesmo dinheiro duas vezes, e a segunda vez
seria culpa nossa. A reserva só é resolvida quando há informação concreta:
`commitPending` na liquidação confirmada, `voidPending` na falha confirmada.
Enquanto o provedor diz apenas "processando", a reserva continua de pé.

O custo é real e é aceito: o saldo do cliente fica travado até a conciliação
resolver. Travar saldo é um incidente de suporte; pagar duas vezes é um
incidente de compliance.

**3. O registro de idempotência NÃO é liberado.**

Falha transitória libera o registro para o cliente ter uma tentativa nova;
falha determinística grava a resposta e a repete. Desfecho desconhecido não é
nenhum dos dois: o registro fica `IN_FLIGHT` com o lease correndo, e quem
roubar o lease **precisa** consultar o provedor pela nossa chave antes de
reexecutar.

**4. A conciliação consulta; nunca reenvia.**

`OperationReconciler` tenta, nesta ordem: a nossa chave de idempotência, o
E2EID, e uma varredura de extrato casando valor e sentido. A ordem é a da
confiança — a chave é nossa e exata, o E2EID é globalmente único mas só existe
a partir de `PROCESSING`, e o extrato é heurística. Uma varredura ambígua (dois
débitos do mesmo valor no mesmo dia) não resolve: adivinhar com dinheiro do
cliente é pior do que continuar sem saber.

Ausência no provedor **não conclui nada**. Pode ser atraso de indexação. A
conclusão definitiva — `FAILED` mais uma quebra de conciliação para revisão
humana — só vem depois da escada inteira de tentativas, e é do worker.

## Consequências

- O 202 é um desfecho de negócio, não um detalhe de estilo, e aparece no
  contrato público: `zOperation` e a rota `GET /v1/operations/:id` existem por
  causa dele.
- O status HTTP real precisa ser gravado no registro de idempotência. Gravar
  200 fixo faria o replay de um 202 voltar como 200, dizendo ao cliente que o
  pagamento liquidou.
- Saldo travado precisa ser observável: `baas_reconciliation_breaks_open` e a
  idade da operação mais antiga em `UNKNOWN` são métricas de alerta, não de
  relatório.
- A escada de retry (`5s, 15s, 60s, 5m, 15m, 1h, 6h`) e o agendamento ficam no
  marco do worker. O resolvedor entregue aqui é **chamável** — pelo endpoint,
  pelo e2e e, depois, pelo worker.

## Alternativas rejeitadas

**Devolver 500 e deixar o cliente retentar.** É o comportamento padrão de quem
não pensou no problema. Com idempotência de ponta a ponta funcionando, o retry
seria absorvido; sem ela — ou quando a chave do cliente expira, ou quando ele
troca de chave depois de um erro — paga duas vezes.

**Liberar a reserva e reconciliar depois.** Deixa uma janela em que o cliente
vê saldo que talvez não exista. A janela dura o tempo da conciliação, que é
justamente quando ele vai olhar o saldo e tentar de novo.

**Reenviar o pagamento na conciliação, com a mesma chave.** Depende de o
provedor honrar idempotência exatamente como documenta, num caminho que já
demonstrou estar degradado. Consultar é sempre seguro; reenviar nunca é.
