# syntax=docker/dockerfile:1.7
#
# Worker: consumidores BullMQ — webhooks, outbox, conciliacao e polling.
#
# O contexto NAO pode ser so `apps/worker`: `apps/worker/tsconfig.json` mapeia
# `@baasconn/api/domain` para `../api/dist`, entao o build depende do build da
# API ter acontecido. `turbo prune --scope` puxa esse subgrafo inteiro, e o
# `--filter=@baasconn/worker...` abaixo constroi as dependencias na ordem.
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS pruner
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm dlx turbo@2.3.3 prune --scope=@baasconn/worker --docker

FROM ${NODE_IMAGE} AS builder
WORKDIR /repo
RUN corepack enable
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY --from=pruner /repo/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && pnpm install --frozen-lockfile

COPY --from=pruner /repo/out/full/ .
RUN pnpm turbo run build --filter=@baasconn/worker...

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid 10001 baas \
 && useradd --uid 10001 --gid baas --no-create-home baas

ENV NODE_ENV=production METRICS_PORT=9464

COPY --from=builder --chown=10001:10001 /repo/node_modules ./node_modules
COPY --from=builder --chown=10001:10001 /repo/packages ./packages
# O `dist` da API viaja junto: o worker importa `@baasconn/api/domain`, que
# aponta para `apps/api/dist`. Sem isto a imagem sobe e falha no primeiro
# `require` — em runtime, nao no build, que e a pior hora para descobrir.
COPY --from=builder --chown=10001:10001 /repo/apps/api ./apps/api
COPY --from=builder --chown=10001:10001 /repo/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=builder --chown=10001:10001 /repo/apps/worker/dist ./apps/worker/dist
COPY --from=builder --chown=10001:10001 /repo/apps/worker/package.json ./apps/worker/package.json

USER 10001:10001
EXPOSE 9464

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/worker/dist/main.js"]
