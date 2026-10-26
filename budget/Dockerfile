# syntax=docker/dockerfile:1
#
# Multi-stage build:
#   1. `build`   compiles the React front end and bundles the Node server (any arch, node:22-alpine)
#   2. runtime   Home Assistant base image + Node, with only what is needed to run
#
# Since 2026 the base image is chosen with FROM (build.yaml is deprecated). The published base image is a
# multi-arch manifest, so the same Dockerfile builds for aarch64 (Home Assistant Green) and amd64.

FROM node:22-alpine AS build
WORKDIR /src

# Install dependencies first so Docker can cache this layer.
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
# Install scripts are skipped on purpose: better-sqlite3 ships prebuilt musl binaries and esbuild/rolldown
# use their platform packages, so no compiler is needed.
RUN npm ci --ignore-scripts

COPY shared shared
COPY server server
COPY web web
COPY scripts scripts
RUN npm run build


FROM ghcr.io/home-assistant/base:latest

RUN apk add --no-cache nodejs

WORKDIR /app
ENV NODE_ENV=production \
    WEB_DIR=/app/web \
    SEED_EXAMPLE_PATH=/app/seed.example.json \
    CONFIG_YAML_PATH=/app/config.yaml

# The server is a single bundled file; only the native SQLite binding stays external.
COPY --from=build /src/server/dist/server.mjs ./server.mjs
COPY --from=build /src/web/dist ./web
COPY --from=build /src/node_modules/better-sqlite3/package.json ./node_modules/better-sqlite3/package.json
COPY --from=build /src/node_modules/better-sqlite3/lib ./node_modules/better-sqlite3/lib
COPY --from=build /src/node_modules/better-sqlite3/prebuilds/linuxmusl-*.node ./node_modules/better-sqlite3/prebuilds/
COPY seed.example.json config.yaml ./

COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]

LABEL org.opencontainers.image.title="Household Budget" \
      org.opencontainers.image.description="Shared household budget for Home Assistant"
