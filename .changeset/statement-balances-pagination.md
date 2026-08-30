---
'@baasconn/provider-spi': minor
'@baasconn/conformance': minor
'@baasconn/adapter-mock-bank': minor
---

Extrato do SPI passa a carregar saldo de abertura e de fechamento, e o Mock
Bank pagina de verdade.

Os saldos sao OPCIONAIS de proposito. Exigi-los obrigaria todo adapter a
devolver um numero mesmo sem ter como calcula-lo, e o caminho de menor esforco
seria repetir o saldo atual. Um saldo ausente a conciliacao declara como passe
pulado; um saldo inventado ela acredita, e passa a abrir quebra de saldo em
cima de ficcao.

Opcionais no SPI, obrigatoriamente coerentes na conformidade: o grupo 11 novo
cobra que `abertura + Σ(creditos − debitos da janela) = fechamento` feche, e
que paginar termine sem repetir cursor nem linha. Os dois saldos precisam vir
de fontes independentes — o razao e as linhas — senao a assercao vira
tautologia.

A tarifa vira linha propria de extrato, com `StatementEntryType.FEE`. O razao
debita `valor + tarifa` da conta do cliente; sem a linha, a soma nao bate com a
variacao de saldo em toda conta que paga tarifa.

Ver ADR 0016.
