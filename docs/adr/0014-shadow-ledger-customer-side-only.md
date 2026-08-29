# ADR 0014: O ledger sombra espelha apenas o lado do cliente

- **Status:** Aceito
- **Data:** 2026-08-29

## Contexto

A ADR 0005 decidiu o motor de partidas dobradas em duas fases, compartilhado
entre o Mock Bank (autoritativo) e o conector (sombra). Falta decidir **quais
pernas** o lado sombra lança.

O Mock Bank, como banco, movimenta cinco contas num PIX out: a subconta do
cliente (`2000.<id>`), o clearing de PIX out (`2200`), a receita de tarifa
(`4000`), a reserva no Bacen (`1000`) e o mundo externo (`9000`). O conector
não é banco.

## Decisão

O ledger sombra lança **apenas** contra as duas contas do cliente —
`2000.<conta>` (disponível) e `2100.<conta>` (bloqueado) — e fecha toda
transação contra `9000` (mundo externo).

Sem `2200`, sem `4000`, sem `1000`.

As duas fases são preservadas: `PIX_OUT_AUTHORIZE` em `PENDING`, resolvido por
`commitPending` ou `voidPending`.

## Por que

**O conector não custodia recurso.** O provedor é o sistema de registro do
dinheiro; nós mantemos um espelho para conciliar em três vias e pegar a classe
de bug que efetivamente custa dinheiro — transação registrada com lançamento
errado. Registrar o clearing do BaaS como nosso contaria como nosso um dinheiro
que nunca esteve conosco.

**A receita de tarifa do BaaS não é receita do conector.** `4000` no livro do
Mock Bank é o que o banco ganhou. Espelhá-la produziria um razão de onde alguém
poderia — e mais cedo ou mais tarde alguém iria — tirar um relatório contábil
errado. O que o cliente pagou de tarifa continua visível: está em
`Transaction.feeCents` e no extrato, que é onde ele pertence.

**`9000` existe exatamente para isto.** É a única conta do plano com
`allowsNegative: true`, e a razão declarada no plano de contas é permitir que
toda transação feche sem caso especial quando o outro lado não é nosso. Um
ledger de partidas dobradas precisa de dois lados; quando o segundo lado é o
mundo, `9000` é o mundo.

**As duas fases não são luxo.** Um PIX out não é atômico: o valor é reservado
na autorização e capturado ou liberado quando o SPI confirma, minutos depois.
Sem a fase pendente, ou debitamos otimista e escrevemos lançamento
compensatório na falha — poluindo o extrato do cliente com transações fantasma
— ou debitamos só na liquidação e permitimos double-spend na janela. E é
justamente a reserva que faz uma segunda transferência concorrente falhar.

**Duas contas por cliente, não uma com campo `blocked`.** Bloqueio judicial é
movimento real: precisa aparecer no extrato e ser auditável. Um booleano na
mesma linha não deixa rastro de quando entrou nem de quanto era.

## Consequências

- O passe 4 da conciliação (cruzamento com o ledger) compara **valor e data**
  do par (provedor, canônico) contra uma transação balanceada nossa. Ele não
  compara pernas contra pernas, porque os dois razões deliberadamente não têm
  as mesmas pernas.
- `MISSING_ON_LEDGER` continua sendo crítico: significa que registramos a
  transação e não a lançamos.
- Um relatório de receita de tarifa não sai deste razão. Sai de
  `Transaction.feeCents`, que é o dado correto para isso.
- O saldo do razão sombra pode divergir do saldo do provedor por tarifa
  cobrada fora de uma transação nossa. Isso é `BALANCE_MISMATCH` e é
  informação, não bug — é exatamente o tipo de divergência que a conciliação
  existe para mostrar.

## Alternativas descartadas

**Espelhar o razão do banco inteiro.** A conciliação ficaria mais simples —
comparar razões idênticos. Mas exigiria conhecer a estrutura contábil interna
de cada BaaS, que nenhum documenta e todos mudam, e produziria um razão que
afirma coisas sobre dinheiro que não é nosso.

**Não manter razão sombra, só a tabela de transações.** É o que a maioria dos
conectores faz, e é por isso que a maioria não detecta lançamento errado. Sem
partidas dobradas não há invariante para verificar: `Σ débitos = Σ créditos`
é o que transforma "achamos que está certo" em "está aritmeticamente
verificado".
