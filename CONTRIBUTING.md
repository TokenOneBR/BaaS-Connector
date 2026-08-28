# Contribuindo

Obrigado por considerar contribuir. O caminho de maior valor para o projeto e
**adicionar ou completar um adapter de provedor** — se e isso que voce quer
fazer, va direto para
[docs/guides/writing-a-provider-adapter.md](docs/guides/writing-a-provider-adapter.md).

## Setup

Requer Node 22 e pnpm 10 (via corepack), mais Docker para integracao e e2e.

```bash
corepack enable
pnpm install
pnpm build
pnpm test
```

Para subir a stack completa:

```bash
pnpm up      # postgres, redis, mock-bank, api, worker, web
pnpm e2e     # fluxo dourado ponta a ponta
pnpm down
```

Para desenvolver so o backend com hot reload:

```bash
docker compose up -d postgres redis mock-bank
pnpm dev
```

## DCO: assine seus commits

Todo commit precisa de `Signed-off-by`. Isso e o
[Developer Certificate of Origin](https://developercertificate.org/): voce
declara que tem o direito de contribuir aquele codigo.

```bash
git commit -s -m "feat(adapter-woovi): implementa criacao de cobranca"
```

Nao usamos CLA. A Apache-2.0 secao 5 ja resolve inbound=outbound, e um passo
de assinatura de CLA mata o PR feito de passagem.

Nao exigimos assinatura GPG/SSH — o porque esta em
[GOVERNANCE.md](GOVERNANCE.md#assinatura-de-commit-a-posicao-pragmatica).

## Titulo do PR

Conventional commits, validado no CI. Use `squash` mentalmente: o titulo do
PR vira a mensagem do commit em `main`.

```
feat(adapter-celcoin): mapeia devolucao parcial
fix(ledger): corrige ordem de lock em transferencia entre contas
docs(guides): explica gravacao de fixtures
```

Escopos comuns: `taxonomy`, `contracts`, `provider-spi`, `adapter-kit`,
`ledger`, `api`, `worker`, `web`, `mock-bank`, `adapter-<slug>`, `deploy`.

## Changeset

Se voce mudou qualquer coisa em `packages/`, o CI vai exigir um changeset:

```bash
pnpm changeset
```

Isso nao e burocracia. E onde voce declara se a mudanca e patch, minor ou
major, e escreve a linha de changelog. Quando alguem mexe no modelo canonico,
essa declaracao e exatamente o sinal que o revisor precisa.

Mudanca so em `apps/`, `docs/` ou `deploy/` nao precisa. Se realmente nao se
aplicar, peca a label `no-changeset`.

## O que o CI vai cobrar

| Check | O que quebra |
|---|---|
| `lint` | ESLint e Prettier |
| `typecheck` | `tsc --noEmit` em todos os projetos |
| `test` | Unit + integracao, com limiar de cobertura por pacote |
| `conformance` | Cada adapter e um check nomeado; falha da QI Tech nao se esconde atras de "testes falharam" |
| `e2e` | Fluxo dourado contra o Mock Bank |
| `db-check` | Drift entre schema e migrations; migration ja aplicada nao pode ser editada |
| `cassette-pii` | Fixture com CPF/CNPJ de digito valido, JWT ou bloco PEM |
| `gitleaks` | Segredo no diff |
| `dependency-review` | Advisory HIGH+ ou licenca copyleft entrando na arvore |

## Regras que nao sao negociaveis

Elas existem porque a alternativa custa dinheiro de verdade:

1. **Dinheiro e `bigint` em centavos.** Nunca `number`, nunca `float`, nunca
   `parseFloat`. Ha regra de lint.
2. **`Date.now()` e proibido.** Use o `Clock` injetado, senao nao da para
   testar janela de devolucao, expiracao de cobranca e re-screening sem
   `sleep`.
3. **Escrita nao idempotente nao e retentada** quando o desfecho e
   desconhecido. Timeout de headers ou body num POST que move dinheiro vira
   `ProviderOutcomeUnknownError` e vai para conciliacao.
4. **Nenhum endpoint devolve credencial de provedor.** Nem mascarada, nem
   parcial. Leitura retorna fingerprint e last4.
5. **Nunca commite documento real.** Fixtures usam documentos sinteticos com
   digito verificador valido.

## Antes de pedir revisao

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Se voce mexeu num adapter: `pnpm test:conformance`.
Se mexeu em schema: `pnpm --filter @baasconn/db exec prisma migrate diff --from-migrations --to-schema-datamodel --exit-code`.

## Revisao

- Adapters: qualquer mantenedor.
- `taxonomy`, `contracts`, `provider-spi`, `ledger`, schema: duas aprovacoes
  do `@tokenone/baas-core`, e mudanca de modelo canonico exige ADR antes.
- `crypto`, auth, admin API, workflows: `@tokenone/baas-security`.

Meta de primeira resposta: 3 dias uteis. Se passar disso, marque
`@tokenone/baas-maintainers` na thread.
