# syntax=docker/dockerfile:1.7
#
# API canonica (/v1) e Admin API (/admin/v1).
#
# `node:22-bookworm-slim`, e NAO distroless: o query engine do Prisma precisa
# de OpenSSL e glibc, e `slim` mantem shell — o que importa muito num projeto
# feito para ser auto-hospedado, onde `kubectl exec` e a primeira ferramenta
# de quem esta depurando um deploy proprio as 3 da manha.
ARG NODE_IMAGE=node:22-bookworm-slim

# ---------------------------------------------------------------------------
# 1. Poda: so o subgrafo de dependencias DESTE app entra no contexto.
#
# `turbo prune --docker` separa o lockfile e os manifests dos fontes, entao
# uma mudanca em `apps/web` nao invalida a camada de `pnpm install` da API. E
# e o que faz o worker construir: `apps/worker/tsconfig.json` mapeia
# `@baasconn/api/domain` para `../api/dist`, entao um contexto que copiasse so
# `apps/worker` nao compilaria.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS pruner
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm dlx turbo@2.3.3 prune --scope=@baasconn/api --docker

# `turbo prune` leva apenas os package.json para `out/json/` — e o postinstall
# de `@baasconn/db` e `prisma generate`, que precisa do schema e do
# `prisma.config.ts`. Sem estes dois, o `pnpm install` da camada de
# dependencias morre com "Could not find Prisma Schema".
#
# So o `prisma/schema` entra, nunca `prisma/migrations`: a camada de install e
# cara e uma migration nova nao tem por que invalida-la.
RUN if [ -d out/json/packages/db ]; then \
      mkdir -p out/json/packages/db/prisma \
   && cp -R packages/db/prisma/schema out/json/packages/db/prisma/schema \
   && cp packages/db/prisma.config.ts out/json/packages/db/prisma.config.ts; \
    fi


# ---------------------------------------------------------------------------
# 2. Dependencias e build
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS builder
WORKDIR /repo
RUN corepack enable
# OpenSSL para o engine do Prisma; python3/make/g++ para o `argon2`, que e
# nativo. Ficam SO nesta etapa: a imagem final nao carrega toolchain.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY --from=pruner /repo/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && pnpm install --frozen-lockfile

COPY --from=pruner /repo/out/full/ .
RUN pnpm turbo run build --filter=@baasconn/api...

# Reinstala so producao — remove as devDependencies da arvore final.
#
# Duas flags, cada uma fechando um erro que so aparece DENTRO da imagem:
#
# `--config.confirmModulesPurge=false`: o pnpm quer confirmar a remocao do
# `node_modules` existente e, sem TTY, ABORTA com
# `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. No runner do CI a variavel
# `CI` mascara isso; dentro do `docker build` ela nao existe.
#
# `--ignore-scripts`: com as devDependencies indo embora, o CLI do `prisma`
# vai junto — e o `postinstall` do `@baasconn/db` e `prisma generate`, que
# entao falha com `prisma: not found`. O cliente JA foi gerado no install
# completo acima e sobrevive: ele e escrito dentro do pacote `@prisma/client`
# no virtual store, que este install so relinca. Verificado instanciando o
# `PrismaClient` na arvore resultante.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts \
      --config.confirmModulesPurge=false

# ---------------------------------------------------------------------------
# 3. Runtime
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid 10001 baas \
 && useradd --uid 10001 --gid baas --no-create-home baas

ENV NODE_ENV=production PORT=3001 METRICS_PORT=9464

COPY --from=builder --chown=10001:10001 /repo/node_modules ./node_modules
COPY --from=builder --chown=10001:10001 /repo/packages ./packages
COPY --from=builder --chown=10001:10001 /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder --chown=10001:10001 /repo/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=10001:10001 /repo/apps/api/package.json ./apps/api/package.json
# A spec OpenAPI viaja na imagem: `GET /docs/v1` a serve a partir do arquivo
# COMMITADO, e nao a gera em runtime — o que o cliente baixa e o que passou
# por revisao no diff. `turbo prune` nao leva `docs/`, entao o COPY e daqui.
COPY --chown=10001:10001 docs/openapi.json ./docs/openapi.json

USER 10001:10001
EXPOSE 3001 9464

# `tini` como PID 1: o Node como PID 1 nao colhe processo zumbi e ignora
# SIGTERM por padrao, entao um pod encerrando esperaria o `terminationGracePeriod`
# inteiro em vez de fechar as conexoes.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/api/dist/main.js"]
