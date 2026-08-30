---
'@baasconn/taxonomy': minor
'@baasconn/provider-spi': minor
'@baasconn/reconciliation': minor
---

Conciliação em três vias, executável de ponta a ponta.

`@baasconn/reconciliation` estreia como pacote: o motor de casamento em cinco
passes, puro e sem I/O, que compara extrato do provedor, registros canônicos e
razão sombra e devolve um **plano** — casamentos, rascunhos de quebra e
intenções de auto-resolução — em vez de efeitos. Inclui o calendário bancário
brasileiro calculado (fixos nacionais mais os derivados da Páscoa por Meeus),
atrás da porta `BusinessCalendar`.

`@baasconn/taxonomy` ganha `UNKNOWN_OUTCOME_LADDER_SECONDS`, a escada de
reconsulta de desfecho desconhecido citada na ADR 0015. Fica ao lado da escada
de retry de webhook porque é decisão de produto, não detalhe do worker.

`@baasconn/provider-spi` ganha `StatementPage`, que estende `Page<StatementEntry>`
com `openingBalance` e `closingBalance` **opcionais**. É aditivo e
retrocompatível — todo adapter existente continua compilando —, e a asserção de
saldo declara honestamente quando pula por falta do dado. Obrigatórios forçariam
todo adapter a inventar um número, e um saldo inventado é pior que um saldo
ausente: o ausente o motor declara, o inventado ele acredita.

Ver ADR 0017 (conciliação em três vias) e ADR 0018 (lock por agregado, e por
que grupos do BullMQ não servem).
