# Governanca

O BaaS Connector e **open source com governanca centralizada**: qualquer
pessoa pode contribuir, e um grupo definido de mantenedores decide o que entra
no modelo canonico. Este documento descreve como isso funciona na pratica e,
mais importante, **como e imposto tecnicamente** — politica sem mecanismo e
folclore.

## Papeis

| Papel | Quem | Pode |
|---|---|---|
| **Admins** | `@tokenone/baas-admins` | Alterar licenca, governanca, CODEOWNERS, protecao de branch |
| **Core** | `@tokenone/baas-core` | Aprovar mudancas em taxonomy, contracts, provider-spi, ledger e schema do banco |
| **Security** | `@tokenone/baas-security` | Aprovar mudancas em crypto, auth, admin API e workflows |
| **Infra** | `@tokenone/baas-infra` | Aprovar mudancas em Docker, Helm e deploy |
| **Mantenedor de adapter** | interno ou externo | Aprovar mudancas no adapter que mantem, e apenas nele |
| **Contribuidor** | qualquer pessoa | Abrir issue e PR |

## Como isso e imposto

Nao por confianca, por configuracao:

1. **CODEOWNERS em camadas por raio de impacto.** Um especialista externo pode
   ser dono do adapter da QI Tech de ponta a ponta e ser **estruturalmente
   incapaz** de alterar o modelo canonico, o codigo de autenticacao, o
   pipeline de release ou o adapter de outro provedor.
2. **Ninguem tem push direto para `main`** — mantenedores e admins inclusive
   (`include_administrators: true`). Essa e exatamente a regra que se contorna
   as 2h da manha, entao ela nao tem excecao.
3. **Squash-merge apenas**, com o titulo do PR (ja validado como conventional
   commit) virando o assunto do commit.
4. Aprovacoes obsoletas sao descartadas a cada novo push; conversas precisam
   estar resolvidas; todos os checks obrigatorios precisam passar.
5. Caminhos de `core` e `security` exigem **duas** aprovacoes.
6. Tags `v*` sao protegidas e so o workflow de release as cria.

## Assinatura de commit: a posicao pragmatica

**Nao exigimos GPG/SSH de contribuidor.** E a maior barreira para a primeira
contribuicao, e trocaria PRs reais de adapter por seguranca marginal. Em vez
disso:

- **Squash-merge apenas** significa que todo commit em `main` e criado *pelo
  GitHub* e carrega a assinatura verificada dele. `main` fica integralmente
  assinada sem onerar ninguem.
- **DCO obrigatorio** (`git commit -s`) da a proveniencia legal, que e o que
  de fato importa.
- **Tags de release assinadas**, produzidas apenas pelo workflow.

Isto e uma decisao registrada, nao um esquecimento.

## Mudancas no modelo canonico

Alterar `taxonomy`, `contracts` ou `provider-spi` afeta todo consumidor.
O caminho e:

1. Abrir issue com o template **Mudanca de taxonomia**.
2. Discutir na issue ate haver convergencia.
3. Abrir um PR de **ADR** em `docs/adr/` registrando a decisao e o porque.
4. Abrir o PR de implementacao, referenciando o ADR, com changeset declarando
   se e patch, minor ou major.

Adicionar um valor de enum e aditivo e barato. Mudar um DTO quebra a API
publica e exige major no pacote.

## Cadeia de suprimento

- Permissao padrao do `GITHUB_TOKEN` e somente leitura.
- Apenas actions verificadas e fixadas por SHA; Dependabot atualiza os pins.
- Publicacao npm por **OIDC Trusted Publishing**: nao existe `NPM_TOKEN` de
  longa duracao para vazar.
- `npm-publish` e `ghcr` sao environments protegidos com revisor obrigatorio.
- Imagens assinadas com cosign, com SBOM anexado.

## Virar mantenedor

O caminho e por contribuicao sustentada, nao por convite social:

1. Contribuicoes de qualidade consistente a um adapter.
2. Entrada no CODEOWNERS **daquele caminho** como mantenedor do adapter.
3. Apos periodo de atuacao e consenso dos mantenedores atuais, promocao a
   mantenedor do projeto.

## Decisoes

Consenso entre os mantenedores da area afetada. Sem consenso, `@tokenone/baas-admins`
decide e registra o porque num ADR. Discordar em publico e bem-vindo; a decisao
registrada e final ate um novo ADR a substituir.
