# syntax=docker/dockerfile:1.7
#
# Job de migracao. Imagem propria, e nao um `command:` da imagem da API.
#
# A imagem da API roda como uid 10001 sem CLI do Prisma e sem os arquivos de
# migracao — carregar `prisma` e o schema multiarquivo nela por causa de um
# job que roda uma vez por release aumentaria a superficie de todo pod da API
# pelo resto do tempo. Aqui o CLI e o unico motivo da imagem existir.
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS pruner
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm dlx turbo@2.3.3 prune --scope=@baasconn/db --docker

FROM ${NODE_IMAGE} AS builder
WORKDIR /repo
RUN corepack enable
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=pruner /repo/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid 10001 baas \
 && useradd --uid 10001 --gid baas --no-create-home baas

ENV NODE_ENV=production

COPY --from=builder --chown=10001:10001 /repo/node_modules ./node_modules
COPY --from=builder --chown=10001:10001 /repo/packages/db ./packages/db

USER 10001:10001

ENTRYPOINT ["/usr/bin/tini", "--"]
# `migrate deploy`, NUNCA `migrate dev`: `dev` pode decidir resetar o banco.
# O advisory lock do Prisma serializa duas execucoes simultaneas, mas o
# desenho nao depende disso — o hook do Helm roda o job exatamente uma vez.
CMD ["node_modules/.bin/prisma", "migrate", "deploy", "--schema", "packages/db/prisma/schema"]
