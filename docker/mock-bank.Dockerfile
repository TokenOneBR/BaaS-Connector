# syntax=docker/dockerfile:1.7
#
# Mock Bank: BaaS falso com razao de partidas dobradas real.
#
# Imagem propria, e nao um modo da API, porque ele precisa ser genuinamente
# EXTERNO: banco proprio, sem foreign key nenhuma para as tabelas do conector.
# Fossem o mesmo processo, um teste de contrato poderia trapacear com join, e
# um bug real de integracao nunca apareceria.
#
# NAO deve ser exposto fora da rede do deploy: `/_control` nao tem
# autenticacao, de proposito. A NetworkPolicy do chart e quem garante isso.
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS pruner
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm dlx turbo@2.3.3 prune --scope=@baasconn/mock-bank --docker

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
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY --from=pruner /repo/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && pnpm install --frozen-lockfile

COPY --from=pruner /repo/out/full/ .
RUN pnpm turbo run build --filter=@baasconn/mock-bank...

# Reinstala so producao. As duas flags estao explicadas em
# `docker/api.Dockerfile`: sem TTY o pnpm aborta a limpeza do node_modules, e
# sem o CLI do prisma (devDependency) o postinstall do `@baasconn/db` falha.
# O cliente do Prisma ja foi gerado no install completo acima.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts \
      --config.confirmModulesPurge=false

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid 10001 baas \
 && useradd --uid 10001 --gid baas --no-create-home baas

ENV NODE_ENV=production MOCK_BANK_PORT=3002

COPY --from=builder --chown=10001:10001 /repo/node_modules ./node_modules
COPY --from=builder --chown=10001:10001 /repo/packages ./packages
COPY --from=builder --chown=10001:10001 /repo/apps/mock-bank/node_modules ./apps/mock-bank/node_modules
COPY --from=builder --chown=10001:10001 /repo/apps/mock-bank/dist ./apps/mock-bank/dist
COPY --from=builder --chown=10001:10001 /repo/apps/mock-bank/package.json ./apps/mock-bank/package.json

USER 10001:10001
EXPOSE 3002

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/mock-bank/dist/main.js"]
