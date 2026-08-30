---
'@baasconn/contracts': minor
---

Adiciona `zOverview`, o agregado do painel do console.

Uma rota, e não nove: o painel não pode custar nove idas ao BFF, cada uma com
o round-trip de sessão, e um agregado próprio lê o necessário em vez de paginar
quatro listas para descartar quase tudo.

`reconciliation.last_success_at` é **nulo** quando nunca houve execução — zero
mentiria "conciliado há pouco", e é exatamente esse campo que o alerta de
obsolescência lê.
