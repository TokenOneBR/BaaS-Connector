# ADR 0017: Conciliação em três vias, com cinco passes ordenados

- **Status:** Aceito
- **Data:** 2026-08-30

## Contexto

O conector nunca custodia recurso — o provedor segue autoritativo. Ainda
assim, mantemos um razão sombra e conciliamos. A pergunta é o que exatamente
comparamos, e em que ordem.

A implementação comum compara duas fontes: o extrato do provedor contra os
nossos registros canônicos. Isso pega a divergência mais visível — um PIX que
o provedor tem e nós não, ou o contrário — e é cego para a classe de bug que
efetivamente custa dinheiro: **registramos a transação corretamente e lançamos
errado no razão**. Nesse caso P e C concordam perfeitamente, e o saldo do
cliente está errado mesmo assim.

## Decisão

### Três fontes, não duas

Comparamos **P** (extrato do provedor, sistema de registro), **C** (nossos
registros canônicos) e **L** (o razão sombra). O terceiro lado é o que
justifica o razão sombra existir: sem conferi-lo, ele é só uma segunda cópia
não verificada.

O lado **L** carrega duas exclusões que decidem se ele presta:

- a conta **bloqueada** fica de fora. `BLOCK_FUNDS` e `UNBLOCK_FUNDS` não têm
  contraparte no provedor, e incluí-los faria todo bloqueio judicial virar uma
  quebra `MISSING_ON_LOCAL` **CRITICAL** falsa — a pior categoria de ruído,
  porque é a categoria que o operador é treinado a levar a sério;
- só entram os tipos que **espelham movimento do provedor**, como predicado
  nomeado e testado sozinho. `PIX_OUT_AUTHORIZE` fica de fora porque a fase
  pendente não é movimento; quem aparece é o `PIX_OUT_SETTLE` que a resolve.
  `RECONCILIATION_ADJUSTMENT` fica de fora porque é a **correção** de uma
  quebra: incluí-lo faria o ajuste de ontem virar a quebra de hoje.

E o lado L é agregado **por transação**, não por lançamento. Um `LedgerEntry` é
metade de uma transação balanceada; emitir um item por lançamento faria o passe
4 contar cada transação duas vezes e a asserção de saldo dobrar.

### Cinco passes, e a ordem é regra

Cada passe consome do conjunto ainda não casado:

1. **Chave forte** — `endToEndId`, senão `providerTransactionId`.
2. **Fuzzy determinístico** — `sha256(conta|sentido|valor|data)`.
3. **Fuzzy com janela** — tolerância de valor e de dias úteis.
4. **Cruzamento com o razão**.
5. **Asserção de saldo**.

A ordem não é organizacional, é de correção: chave forte primeiro, senão o
passe fuzzy rouba um casamento que a chave forte faria com certeza. Inverter 1
e 2 mata oito testes, e o sintoma é sutil — o par casa do mesmo jeito, mas com
confiança `HIGH` em vez de `EXACT`, e o painel passa a pedir revisão humana de
casamentos que eram certos.

Quatro detalhes decidem se o motor está certo ou só parece certo:

- **A chave forte é namespaced** (`e2e:` / `ptx:`). Um provedor que use o
  E2EID como `providerTransactionId` produziria, sem namespace, um casamento
  entre o E2EID de um item e o `providerTransactionId` de **outro** — casamento
  errado com confiança `EXACT`, que é o pior desfecho possível.
- **O guloso do passe 2 desempata por id**, lexicograficamente. Sem isso, duas
  execuções da mesma janela produzem casamentos diferentes e o conjunto de
  quebras oscila. O operador perde a confiança no painel antes de perder
  dinheiro.
- **A tolerância proporcional é `bigint` puro.** `valor * 0,0001` em ponto
  flutuante perde precisão acima de 2⁵³ e a tolerância cresce em silêncio,
  produzindo casamentos errados exatamente nos valores que mais importam.
- **A supressão pela graça de liquidação é por ITEM, não pela janela.** O PIX
  liquida na hora, mas o extrato posta em dia útil: um movimento nosso de três
  minutos atrás legitimamente ainda não aparece lá. Um movimento de ontem
  dentro de uma janela recente, porém, **já deveria** — suprimir pela janela
  esconderia exatamente esse caso.

### O motor devolve um plano, não efeitos

`reconcile()` é uma função pura sobre três listas. Devolve casamentos,
rascunhos de quebra, contadores e intenções de auto-resolução; não persiste
nada e não faz I/O. É o que torna possível rodá-lo contra a janela de ontem em
produção e **ver** as quebras que ele abriria, sem escrever uma linha.

### Calendário calculado, não tabelado

Não existe helper de dia útil na taxonomia, e uma tabela de feriados precisaria
ser mantida — ficaria errada em silêncio, e o único sintoma seria um
`DATE_MISMATCH` falso em fevereiro. Então o calendário é **calculado**: fixos
nacionais (incluindo 20/11 a partir de 2024, Lei 14.759/2023) mais os derivados
da Páscoa por Meeus — Carnaval `E−48`/`E−47`, Sexta-feira Santa `E−2`, Corpus
Christi `E+60`.

`BusinessCalendar` é uma porta injetável, então um provedor com calendário
próprio substitui a implementação.

**Declarado como não coberto:** feriados estaduais e municipais, e 24/31 de
dezembro (atrás de flag, padrão `false`). O SPI é nacional e o extrato do
provedor segue o calendário bancário nacional; tratar um feriado municipal como
dia útil apenas **encolhe** a janela do passe 3 em um dia. É um erro
conservador — gera um `MISSING_ON_*` a mais em vez de um casamento errado a
menos.

## Consequências

### Fan-out em todas as contas ativas, todo dia

É O(contas) chamadas de extrato por execução, e é o custo aceito. Conciliar
apenas as contas com movimento **nosso** na janela deixaria de fora exatamente
a conta que recebeu um PIX cujo webhook se perdeu — que é o `MISSING_ON_LOCAL`
de maior valor que a conciliação acha, e o caminho de recuperação que o produto
promete. O fan-out é um job de fila, então limitar taxa depois é configuração,
não redesenho.

### `ReconciliationRun.accountId` nunca é NULL

O `@@unique([connectionId, accountId, scope, windowStart, windowEnd])` tem
`accountId` nullable, e em Postgres `NULL` não é igual a `NULL` num índice
único. A premissa de que a chave única impediria execuções duplicadas é
**falsa** para um run de conexão inteira: dois pods criariam dois runs para a
mesma janela sem violar nada.

A decisão é não depender do banco para isso: **nunca criamos run com
`accountId` NULL**. O gatilho manual faz fan-out por conta em vez de criar um
run de conexão. É a terceira vez que uma coluna nullable dentro de um
`@@unique` produz o mesmo defeito neste schema (as outras:
`ReconciliationBreak.endToEndId`, corrigido com `dedupeKey` derivado, e
`PollCursor.scopeId`) — o padrão está registrado aqui para a quarta ser
reconhecida na revisão em vez de em produção.

### Paginação do extrato não é opcional

Se o executor ignorar `hasMore`, um provedor real que pagine trunca a janela em
silêncio e produz `MISSING_ON_LOCAL` fantasma. **Quebra inventada é pior que
quebra nenhuma**: o operador para de acreditar no painel e passa a ignorar a
quebra de verdade quando ela vier.

### `MISSING_ON_PROVIDER` de débito nunca resolve sozinho

Significa que podemos ter registrado um pagamento que não aconteceu. A correção
— reversão no razão ou escalação ao provedor — exige julgamento. O motor não
emite a intenção e o executor não tem caminho para ela.

### Lançamento de razão órfão

Um item L sem par (P,C) significa que lançamos duas vezes ou lançamos do nada —
metade da classe de bug que o razão sombra existe para pegar. Nenhum dos onze
`BreakType` nomeia isso; sai como `MISSING_ON_LOCAL` com `ledgerItemId`
preenchido e `providerItemId` ausente, `CRITICAL`, e a auto-resolução de
importação fica guardada por `providerItemId != null`. `ORPHAN_LEDGER_ENTRY` no
enum é follow-up.

### O sentido de um ajuste manual não sai de `amountCents`

`ReconciliationBreak.amountCents` é a **magnitude** do movimento, não um delta
assinado. `deltaCents` é o assinado (`provedor − nós`). Derivar o sentido do
primeiro inverte a correção em toda quebra de ausência: um PIX de entrada que o
provedor nunca teve seria creditado de novo em vez de estornado, e o ajuste
dobraria o erro que veio consertar. Quando não há `deltaCents`, o sentido vem
do **item** que originou a quebra — desfazendo o movimento se ele é nosso,
aplicando-o se é do provedor — e um tipo que não determina sentido **recusa**,
em vez de adivinhar um número para lançar na conta de um cliente.
