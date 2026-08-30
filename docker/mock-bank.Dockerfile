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

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

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
