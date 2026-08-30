# Desenvolvimento local

Guia para sair de um clone limpo até a API respondendo.

## Pré-requisitos

- **Node 22.11 ou superior** (`.nvmrc` fixa a versão; `nvm use` resolve)
- **pnpm 10** — `corepack enable && corepack prepare pnpm@10.33.0 --activate`
- **Docker** para Postgres e Redis (ou instâncias suas)

## Primeira execução

```bash
pnpm install
cp .env.example .env
pnpm --filter @baasconn/db exec prisma generate
```

`prisma generate` é obrigatório antes do primeiro `typecheck`: o cliente
tipado é gerado a partir do schema, não versionado.

Gere o par de chaves da sessão do console e cole no `.env`:

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out jwt.key
openssl rsa -in jwt.key -pubout -out jwt.pub
```

`JWT_PRIVATE_KEY` e `JWT_PUBLIC_KEY` recebem o PEM inteiro, com as quebras de
linha. Assimétrico de propósito: a chave privada fica só na API, e quem
precisar apenas validar o token recebe a pública.

## Verificação sem infraestrutura

Tudo abaixo roda sem Postgres, sem Redis e sem rede:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

A suíte inteira é offline por decisão de projeto. Os adapters são exercitados
contra fixtures HTTP gravadas, servidas por um servidor `node:http` real; as
invariantes do banco rodam sobre PGlite (Postgres compilado para WASM). Um
contribuidor externo consegue o ciclo completo de desenvolvimento sem
credencial de nenhum BaaS.

## Com infraestrutura

```bash
docker compose up -d postgres redis
pnpm --filter @baasconn/db exec prisma migrate deploy
pnpm --filter @baasconn/api dev
```

A API sobe em `http://localhost:3001` e as métricas em
`http://localhost:9464/metrics` — **porta separada**, porque `/metrics` num
listener público vaza nomes de conexão e volumes, e é um vetor de DoS barato.

## Configuração

A API valida a configuração no boot e **se recusa a subir** com segredo
faltando. Descobrir que `KMS_MASTER_SECRET` não está configurado na primeira
gravação de credencial é pior do que não subir.

Duas recusas merecem destaque, porque parecem rigidez e não são:

- **`KMS_DRIVER=local` em produção** é rejeitado. O driver local guarda a
  chave mestra numa variável de ambiente, o que anula o ponto da cifra em
  envelope: quem lê o ambiente do processo lê todas as credenciais de
  provedor.
- **`BLIND_INDEX_PEPPER` com menos de 32 caracteres** é rejeitado. CPF tem 11
  dígitos; com um pepper curto o espaço de busca continua enumerável, e o
  índice cego deixa de proteger o que existe para proteger.

Em `NODE_ENV=test` todos os valores têm padrão, para a suíte não exigir
configuração.

## Sondas de saúde

| Rota | O que checa |
|---|---|
| `GET /healthz` | Apenas o processo. **Não toca Postgres nem Redis.** |
| `GET /readyz` | Postgres e Redis, com resultado em cache por 5s. |

`/healthz` é deliberadamente cego para a infraestrutura: se a liveness
checasse o banco, uma oscilação de Postgres reiniciaria todos os pods e
transformaria degradação em outage.

Nenhuma das duas checa provedor terceiro. A Celcoin ter uma tarde ruim não
pode fazer o Kubernetes tirar os pods de serviço; a saúde do provedor é
exposta em `/admin/v1/providers` e como métrica de estado do circuito.

## Console

O primeiro usuario NAO existe num banco recem-migrado: nao ha rota de
cadastro, e `OWNER`/`ADMIN` exigem segundo fator sem que exista enrolamento
self-service. Quem cria o primeiro e o **seed**:

```bash
pnpm up          # ja roda o seed no fim
# ou, contra um banco proprio:
pnpm seed
```

Ele imprime o e-mail, a senha, o segredo TOTP em base32 e um link
`otpauth://` para o autenticador. E idempotente: rodar duas vezes nao duplica
nada e nao troca a senha de quem ja existe.

Para trabalhar sem banco nenhum, `pnpm demo` sobe tudo em memoria e imprime as
mesmas credenciais, mais uma API key pronta.

## Armadilhas conhecidas

**`Nest can't resolve dependencies (?, Object)` no boot.** Algum import usado
em parâmetro de construtor virou `import type`. Isso apaga o valor em runtime,
que é exatamente o que o `emitDecoratorMetadata` grava para o container
resolver a dependência. A regra `@typescript-eslint/consistent-type-imports`
está desligada nos apps NestJS por esse motivo — se você a religar, o autofix
quebra a injeção.

Serviços que recebem uma **interface** no construtor precisam de token
explícito (`@Inject(ALGUM_TOKEN)`): interface não existe em runtime. O teste
`apps/api/test/wiring.spec.ts` compila o grafo inteiro justamente para
transformar esse erro de boot em falha de CI.

**`Date.now()` reprovado no lint.** Use o `Clock` injetado (token `CLOCK`).
Lease de idempotência, janela de assinatura e TTL de cache são lógica temporal
com consequência de dinheiro, e testá-los com o relógio do sistema exigiria
`sleep` — que deixa a suíte lenta e intermitente, os dois motivos pelos quais
um teste de tempo acaba deletado em vez de consertado.
