# ADR 0005: Ledger de partidas dobradas em duas fases

- **Status:** Aceito
- **Data:** 2026-08-28

## Contexto

Precisamos de saldo confiavel no Mock Bank (autoritativo) e de uma base de
comparacao para conciliacao no conector (sombra).

## Decisao

Modelo do TigerBeetle com nomenclatura Modern Treasury: quatro contadores por
conta (`debits_pending`, `credits_pending`, `debits_posted`, `credits_posted`),
transferencias em duas fases (`PENDING` -> `POST_PENDING` | `VOID_PENDING`),
lancamentos imutaveis. Tabelas `ledger_account`, `ledger_transaction`,
`ledger_entry`.

Saldos materializados em colunas contadoras, mais snapshots diarios encadeados
por hash, mais job de verificacao.

## Por que duas fases

Um PIX out **nao e atomico**. O dinheiro precisa ser reservado na autorizacao e
capturado ou liberado quando o SPI confirma, minutos depois. Sem fase pendente
voce ou debita otimista e escreve lancamento compensatorio na falha —
poluindo o extrato do cliente com transacao fantasma — ou debita so na
liquidacao e permite double-spend na janela.

## Por que saldo materializado

`SUM(entries)` on-the-fly e correto e simples, mas uma subconta com 500 mil
lancamentos torna cada leitura de saldo um heap scan. Pior: o caminho quente
(PIX out) precisa do saldo **sob lock**; transformar leitura O(1) em agregacao
O(n) sob lock de escrita e um precipicio de throughput.

Materializar tambem e o que torna possivel a guarda de saldo negativo como
`CHECK` constraint — um `CHECK` nao pode agregar outra tabela.

Risco de drift entre contador e lancamentos, mitigado por: (a) contadores so
mutados por uma stored procedure `SECURITY DEFINER`, com `REVOKE UPDATE` das
colunas para o papel da aplicacao; (b) snapshots diarios imutaveis encadeados;
(c) job de verificacao horario nas contas tocadas e noturno completo.

## Consequencias

Mais complexo que um modelo ingenuo de transacoes. A metrica
`baas_ledger_imbalance_detected_total` precisa ficar sempre em zero, e
qualquer incremento e incidente.
