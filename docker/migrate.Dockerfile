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
# `packages/` inteiro, e nao so `db`: o seed importa `@baasconn/crypto` (para
# cifrar o segredo TOTP com a mesma KMS da API) e `@baasconn/taxonomy` (para
# cunhar os ULIDs com prefixo). Copiar so `db` fazia a imagem migrar e falhar
# no seed — em runtime, que e a pior hora para descobrir.
COPY --from=builder --chown=10001:10001 /repo/packages ./packages

USER 10001:10001

ENTRYPOINT ["/usr/bin/tini", "--"]
# `migrate deploy`, NUNCA `migrate dev`: `dev` pode decidir resetar o banco.
# O advisory lock do Prisma serializa duas execucoes simultaneas, mas o
# desenho nao depende disso — o hook do Helm roda o job exatamente uma vez.
#
# Duas correcoes de caminho, ambas fatais e ambas so visiveis em runtime:
#
#   `packages/db/node_modules/.bin/prisma`, e nao `node_modules/.bin/prisma`.
#   O CLI e devDependency de `@baasconn/db`; o pnpm nao expoe binario de
#   dependencia de pacote no `.bin` da RAIZ. O container morria com
#   "no such file or directory" antes de tocar o banco.
#
#   `--config`, e nao `--schema`. O `prisma.config.ts` e quem declara
#   `migrations.path`, e o Prisma so o descobre a partir do diretorio
#   corrente — que aqui e `/app`. Sem ele, o Prisma procurava as migrations
#   em `prisma/schema/migrations`, nao achava nenhuma, e saia com codigo
#   ZERO: o job "de migracao" terminava com sucesso sem aplicar nada.
CMD ["packages/db/node_modules/.bin/prisma", "migrate", "deploy", "--config", "packages/db/prisma.config.ts"]
