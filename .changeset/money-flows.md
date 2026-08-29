---
'@baasconn/taxonomy': minor
'@baasconn/contracts': patch
---

Fluxos de dinheiro: saldo com cache, chaves Pix, cobrancas, Pix in/out,
devolucao, extrato e o caminho de desfecho desconhecido.

Na taxonomia, dois acrescimos aditivos: o evento `pix_refund.created`, que
faltava — havia `received` (entrada) e `settled`, mas nenhum para o momento em
que o provedor aceita uma devolucao que NOS enviamos — e a exportacao de
`StatementEntryDto` nos contratos.

Nenhuma quebra de contrato publico: os enums, as tabelas de transicao e o
formato de dinheiro no wire seguem iguais.
