# ADR 0006: Admin API separada da API publica

- **Status:** Aceito
- **Data:** 2026-08-28

## Contexto

O console precisa de operacoes que uma chave de API integradora jamais deve
alcancar: criar e revogar chaves, gravar credencial de provedor, ler a trilha
de auditoria, disparar conciliacao.

## Decisao

Duas superficies no mesmo processo NestJS: `/v1` (API key, stateless, sem
cookie) e `/admin/v1` (sessao de usuario, RBAC). Separadas por modulo, guard
global, prefixo de rota, politica de rate limit e documento OpenAPI.

## Por que separadas

Se a gestao de chaves vivesse em `/v1`, uma chave vazada poderia cunhar mais
chaves — escalada de privilegio direta. Adicionar autenticacao por cookie a
`/v1` criaria superficie de CSRF em endpoints que movem dinheiro.

## Por que no mesmo processo

O stakeholder pediu "arquitetura simples". Uma imagem Docker, um deployment
Helm, um pool de conexao. A separacao que importa e de autorizacao, e essa e
imposta por guard e por CODEOWNERS, nao por fronteira de processo.

## Consequencias

O `/admin/v1` nao precisa ser exposto no ingress: o console fala com ele
dentro do cluster. Um deploy que o exponha por engano ainda exige sessao
autenticada, mas o padrao do chart e nao expor.
