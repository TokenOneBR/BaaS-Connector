# syntax=docker/dockerfile:1.7
#
# Console (Next.js App Router, atuando como BFF).
#
# `output: 'standalone'` e `API_INTERNAL_URL` lido em RUNTIME: a mesma imagem
# serve homologacao e producao. Embutir o endereco no build daria duas
# imagens por release e a chance de promover a errada.
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS pruner
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm dlx turbo@2.3.3 prune --scope=@baasconn/web --docker

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


FROM ${NODE_IMAGE} AS builder
WORKDIR /repo
RUN corepack enable
COPY --from=pruner /repo/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && pnpm install --frozen-lockfile

COPY --from=pruner /repo/out/full/ .
# Telemetria do Next desligada no build: uma imagem que chama a rede durante
# `docker build` falha em runner sem egresso, e um build reproduzivel nao
# deveria depender de terceiro nenhum.
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm turbo run build --filter=@baasconn/web...

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid 10001 baas \
 && useradd --uid 10001 --gid baas --no-create-home baas

ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0

# O `standalone` ja traz o subconjunto de `node_modules` que o servidor usa —
# e por isso que esta imagem nao copia `node_modules` inteiro nem reinstala.
COPY --from=builder --chown=10001:10001 /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=10001:10001 /repo/apps/web/.next/static ./apps/web/.next/static

USER 10001:10001
EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/web/server.js"]
