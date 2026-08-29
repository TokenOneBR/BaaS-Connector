# Fluxos de dinheiro

Este guia descreve o que acontece dentro do conector quando dinheiro se move, e
por quê. A ordem das operações não é arbitrária: cada passo está onde está
porque a alternativa produz um erro que custa dinheiro.

## Saldo

`GET /v1/accounts/:id/balance`

O padrão serve do cache, e a resposta **sempre** declara a frescura — em
`_meta.freshness` e nos cabeçalhos `X-Baas-Data-Source` e `X-Baas-Data-Age`. As
duas coisas andam juntas: servir cache sem declarar seria mentir; declarar sem
cachear seria martelar o endpoint do provedor até tomar rate limit numa conexão
que é compartilhada por todos os clientes.

O padrão só é defensável por causa dos **seis bypasses obrigatórios**, que
ignoram o cache mesmo com valor quente:

| # | Regra | Por quê |
|---|---|---|
| 1 | `?consistency=strong` explícito | O cliente pediu o valor de verdade |
| 2 | Autorização de Pix out | **Hard-coded.** Um operador afrouxando isto autoriza pagamento contra saldo velho |
| 3 | Movimento local recente nesta conta | O provedor pode não ter propagado, mas o cache com certeza está velho |
| 4 | A conexão não tem `webhooks.inbound` | Sem invalidação por evento, saldo por TTL é chute |
| 5 | Quebra de conciliação aberta com severidade alta | O saldo já é suspeito |
| 6 | O `asOf` do cache é anterior ao último movimento conhecido | O cache perdeu um evento |

Leitura forte com o provedor fora do ar devolve **503**. Com
`?on_provider_error=serve_stale`, devolve 200 com `_meta.freshness.degraded` e
`Warning: 110`. Nunca serve stale em silêncio numa leitura forte.

`?source=ledger` lê o razão sombra em vez do provedor. É como um operador
enxerga drift — e é a leitura correta para verificar uma reserva nossa, porque
o saldo do provedor reflete a reserva **dele**, não a nossa.

Invalidação é sempre por **tag set** (`SADD` / `SMEMBERS` / `UNLINK`). `SCAN` e
`KEYS` percorrem o keyspace inteiro e degradam o Redis para todos os clientes
ao mesmo tempo — nunca em caminho quente.

## Chaves Pix

O valor é **normalizado antes de sair** para o provedor: documento só dígitos,
telefone em E.164, e-mail em minúsculas. `Joao@X.com` e `joao@x.com` são a
mesma chave no DICT; guardar as duas formas produz duas linhas que o índice
único parcial não consegue reconciliar.

O valor é indexado por **blind index** (`HMAC-SHA256(pepper, valor)`), não em
claro. Um vazamento só do banco não entrega a chave nem um hash atacável por
rainbow table — o pepper vive no KMS.

Registrar a mesma chave na mesma conta é **no-op**, não erro: o cliente pode ter
perdido a resposta. Registrar uma chave já ativa em **outra** conta do mesmo
ambiente é `409 PIX_KEY_ALREADY_EXISTS`.

Consulta DICT de chave de terceiro (`GET .../pix/keys/resolve`) é informativa
por definição: **não autoriza pagamento**. O destino é resolvido de novo no
envio, porque uma consulta antiga pode apontar para uma conta que já mudou de
dono. Toda consulta gera linha de auditoria — é dado pessoal de alguém que nem
cliente nosso é.

## Cobranças

O BR Code devolvido pelo provedor é **validado com `parseBrCode` antes de ser
gravado**. Provedor devolver EMV malformado em sandbox é comum, e guardar sem
conferir significa que o QR falha no balcão, com o erro aparecendo do lado do
cliente, horas depois e sem rastro.

A validação inclui a chave contida no payload. Esse é o caso perigoso: um QR que
aponta para outra chave é sintaticamente válido, nenhum parser reclama, e o
dinheiro simplesmente vai para a conta errada.

## Pix out

`POST /v1/accounts/:id/pix/transfers` — escopo `pix:write`, capacidade
`pix.out.send`, **assinatura HMAC obrigatória** e **idempotência obrigatória**.

A ordem é a decisão que importa:

1. **Resolve o destino.** `emv` e `qr_code` são parseados para chave *antes* de
   sair. Repassar o payload cru deixaria cada adapter reimplementando o codec do
   BACEN, e um deles erraria.
2. **Autoriza no razão sombra (`PENDING`).** O hold é o que faz uma segunda
   transferência concorrente falhar. Autorizar depois da resposta do provedor
   deixa uma janela em que as duas veem o saldo cheio — e é assim que se paga
   duas vezes.
3. **Chama o provedor** com o nosso `operationId` como chave de idempotência —
   nunca a chave do cliente, cujo formato é arbitrário e pode violar regras do
   provedor.
4. **Sucesso:** `Transaction` + `PixDetail` gravados, com o hold ligado em
   `ledgerPendingTransactionId`.
5. **Recusa determinística** (chave inválida, saldo do provedor): `voidPending`,
   o hold é liberado. Segurar saldo por um pagamento que comprovadamente não
   aconteceu é defeito visível.
6. **Desfecho desconhecido:** `202`, transação em `UNKNOWN`, e o **hold é
   mantido**. Ver [ADR 0015](../adr/0015-unknown-outcome-holds-the-reserve.md).

O E2EID chega **nulo** na criação quase sempre: é gerado pelo PSP do pagador e
só aparece em `PROCESSING`/`SETTLED`. Assumir que existe na criação é a
pegadinha clássica.

## Pix in

Chega por webhook. É o **único** caso em que um evento cria registro: ninguém
pediu o pagamento, ele simplesmente chegou. O crédito no razão sombra e a
gravação da transação acontecem juntos — um extrato com crédito que o razão não
conhece é exatamente a quebra que a conciliação existe para achar.

O dedupe de último recurso é pelo E2EID, que é globalmente único no Pix. É o que
salva quando o provedor reentrega com um id de evento novo.

## Devolução

Uma devolução é uma transação **nova**, filha da original — nunca uma edição da
original. Editar apagaria o fato de que o dinheiro entrou, e o extrato do
cliente deixaria de bater com o do banco.

Duas regras canônicas, verificadas aqui e não em cada adapter: a janela de **90
dias** e a soma acumulada (`Σ devoluções ≤ original`). Um adapter que as
esquecesse devolveria mais dinheiro do que entrou.

## Extrato

`GET /v1/accounts/:id/statement` — paginação por **keyset** sobre
`(effective_date desc, id desc)`. Offset foi rejeitado: sobre tabela que recebe
insert constante ele produz duplicata e buraco, e num extrato financeiro isso é
bug de correção, não de desempenho.

O cursor é assinado com HMAC e carrega o digest dos filtros. A assinatura não
esconde nada (o conteúdo é base64) — detecta adulteração. O digest detecta troca
de filtro no meio da paginação, que produziria um resultado que não é nem uma
consulta nem a outra, sem erro nenhum. O `limit` fica **fora** do digest: mudar
o tamanho da página não altera o conjunto de resultados.

Só entram estados que **já aconteceram** (`SETTLED`, `REVERSED`,
`PARTIALLY_REVERSED`). Uma transferência em voo faria o cliente conciliar contra
um movimento que ainda pode ser desfeito.

## Testando localmente

O Mock Bank deriva o comportamento do Pix out dos **dois últimos dígitos do
valor em centavos**, então nenhum teste precisa mexer em estado:

| Centavos | Cenário |
|---|---|
| `,13` | `INSUFFICIENT_FUNDS` |
| `,51` | 500 do provedor |
| `,29` | Não responde — exercita o desfecho desconhecido |
| `,44` | Liquida e devolve automaticamente após 5s |
| `,07` | Webhook entregue **duas vezes** |
| `,08` | Webhook **fora de ordem** (settled antes de pending) |

`GET /_control/magic` no Mock Bank serve a tabela completa. A conexão aceita
`config.requestTimeoutMs` para encurtar o timeout do adapter — o cenário `,29`
não responde nunca, e os 10s padrão custariam 10s por teste.
