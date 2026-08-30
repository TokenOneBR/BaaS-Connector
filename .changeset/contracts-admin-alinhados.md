---
'@baasconn/contracts': minor
---

Alinha os contratos administrativos com o que a API realmente devolve.

`zLoginResult` ganha `token_type` e o `user` aninhado, e **perde**
`mfa_required`: a API lança `MFA_REQUIRED` quando o segundo fator falta, e
devolver também uma flag daria duas fontes para a mesma verdade — o cliente que
lesse a errada trataria uma recusa como sucesso.

`zSession` ganha `session_id` e passa a descrever `GET /me` de verdade.

`zReconciliationBreak` declara `adjustment_transaction_id`, que a rota já
emitia sem estar no contrato.

`zTriggerReconciliation.account_id` passa a ser **obrigatório**. A chave única
de `ReconciliationRun` inclui a conta, e em Postgres NULL não é igual a NULL num
índice único — um run de conexão inteira escaparia da deduplicação. Reconciliar
uma conexão é outra operação: um *sweep*, que enumera as contas.
