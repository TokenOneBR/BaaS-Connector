---
'@baasconn/reconciliation': minor
---

Motor de conciliacao em tres vias: provedor, registros canonicos e razao
sombra. Cinco passes puros, sem framework e sem I/O, que devolvem um PLANO —
casamentos, rascunhos de quebra, contadores e intencoes de auto-resolucao — e
nunca efeitos.

A ordem dos passes e regra e nao preferencia: a chave forte roda primeiro
porque o passe fuzzy pareia por proximidade de instante e roubaria um
casamento que o E2EID faria com certeza.

Calendario bancario nacional calculado, nao tabelado, com os feriados
derivados da Pascoa por Meeus. Uma tabela de feriados fica errada em silencio,
e o unico sintoma seria um `DATE_MISMATCH` falso em fevereiro.
