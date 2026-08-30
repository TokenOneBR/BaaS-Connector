# ADR 0019 — Containerização e deploy

**Estado:** Aceito · **Data:** 2026-08-30

## Contexto

O projeto é feito para ser **auto-hospedado**. Quem o adota vai rodá-lo no
próprio cluster, com o próprio Postgres, e vai precisar depurar sozinho às
três da manhã. Isso muda várias escolhas que num serviço gerenciado seriam
óbvias.

## Decisões

### `node:22-bookworm-slim`, não distroless

O query engine do Prisma precisa de OpenSSL e glibc. Além disso, `slim` mantém
um shell, e `kubectl exec` é a primeira ferramenta de quem investiga um deploy
próprio. Distroless economiza alguns megabytes e cobra isso exatamente na hora
em que a pessoa mais precisa entrar no container.

### `turbo prune --docker` por imagem

Cada imagem instala só suas dependências transitivas. Uma mudança em
`apps/web` não invalida a camada de `pnpm install` da API.

Sem isso, o worker **não constrói**: `apps/worker/tsconfig.json` mapeia
`@baasconn/api/domain` para `../api/dist`, então um contexto que copiasse
apenas `apps/worker` falharia. A imagem do worker leva o `dist` da API junto —
uma imagem que omitisse isso subiria e falharia no primeiro `require`, em
runtime.

### Imagem própria para as migrations

Não é um `command:` da imagem da API. Carregar o CLI do Prisma e os arquivos
de migração em **todo pod da API, pelo resto do tempo**, por causa de um job
que roda uma vez por release, é superfície sem contrapartida.

### `tini` como PID 1

O Node como PID 1 não colhe processo zumbi e ignora `SIGTERM` por padrão. Um
pod encerrando esperaria o `terminationGracePeriod` inteiro em vez de fechar as
conexões — e no worker isso significaria matar um job de conciliação no meio.

### Migração como hook `pre-upgrade`, não initContainer

Com duas ou mais réplicas, os initContainers correm entre si. O advisory lock
do Prisma evita corrupção, mas cada pod fica bloqueado pela migração inteira e
o timing das probes fica feio. O hook roda **exatamente uma vez**, e uma
migração que falha aborta o release antes de qualquer pod novo subir — que é a
diferença entre um upgrade que não aconteceu e um upgrade pela metade.

`backoffLimit: 0`. Uma migração que falhou provavelmente falha de novo, e a
segunda tentativa pega o banco no estado deixado pela primeira.

### `livenessProbe` não toca o Postgres

Se tocasse, uma oscilação de banco reiniciaria todos os pods de uma vez e
transformaria degradação em outage. `/healthz` é liveness do **processo**.

`readinessProbe` olha Postgres e Redis, com resultado cacheado por 5s. E
**nunca** um provedor terceiro: a Celcoin ter uma tarde ruim não pode tirar
nossos pods de serviço. Saúde de provedor é métrica e rota administrativa.

### Credenciais de provedor não vivem no Kubernetes

São linhas envelope-encrypted no Postgres, com a data key envolvida pelo KMS da
nuvem. É por isso que o chart é pequeno, que adicionar um provedor não exige
redeploy, e que o mesmo chart roda em EKS, GKE e AKS mudando **uma anotação de
ServiceAccount**.

No Kubernetes ficam apenas `DATABASE_URL`, `REDIS_URL`, `JWT_PRIVATE_KEY`,
`JWT_PUBLIC_KEY` e `BLIND_INDEX_PEPPER`.

### Um template explícito por componente

Não um `range` sobre um mapa, não quatro charts. Mais verboso, e legível por
qualquer pessoa que saiba Kubernetes sem antes precisar aprender este chart.
Para um projeto open source que as pessoas vão adaptar, essa é a troca certa.

### NetworkPolicy não é opcional

`metrics-server.ts` sempre documentou que a porta 9464 "fica atrás da
NetworkPolicy" — até este chart existir, isso era uma promessa sem nada por
trás. `/metrics` alcançável vaza nomes de conexão e volumes, e é vetor de DoS
barato.

A mais importante é a do Mock Bank: `/_control` **não tem autenticação** e
injeta crédito em conta. A policy é a única coisa entre um Mock Bank
habilitado por engano e um endpoint público que cunha dinheiro.

### Compose de observabilidade em arquivo separado

`docker compose up` para um contribuidor novo são seis containers, não dez. A
diferença entre "subiu" e "desistiu" num primeiro contato costuma ser essa.

## Consequências

- Cinco imagens em vez de quatro (a de migração é a quinta).
- `arm64` só em tag: build cruzado com QEMU em todo push triplica o CI por um
  artefato que só o release usa.
- O compose **exige** `JWT_PRIVATE_KEY` em vez de trazer um par embutido. Uma
  chave de assinatura de sessão committada é uma chave que alguém promove para
  produção sem notar. `pnpm dev:env` a gera localmente.

## Não verificado neste ambiente

O build das imagens e o `helm install` num cluster. O daemon do Docker não
roda no ambiente onde este chart foi escrito, e o helm não é instalável
(`get.helm.sh` é bloqueado pelo proxy de egresso). Os dois têm job de CI que
os exercita. O que roda localmente é `docker compose config` — que valida
schema, interpolação e profiles sem daemon — e
`scripts/check-helm-templates.ts`, que pega bloco sem `end` e delimitador sem
fechar, e que **não substitui** `helm lint`.
