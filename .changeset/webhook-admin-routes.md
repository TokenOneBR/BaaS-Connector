---
'@baasconn/contracts': minor
---

Adiciona os contratos das rotas administrativas de webhook: eventos de
entrada, endpoints do cliente e entregas de saida. Os dois ultimos estendem
os contratos publicos com `.extend`/`.omit` em vez de redeclarar os campos —
sao os mesmos campos, e duas declaracoes da mesma forma divergem na primeira
mudanca. O `secret` do contrato publico e retirado por `.omit`, porque
nenhuma rota administrativa o serve.
