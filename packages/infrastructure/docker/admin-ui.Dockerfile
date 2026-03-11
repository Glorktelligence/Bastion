# Bastion Admin UI — Docker Image
#
# SvelteKit admin panel for relay management.
#
# Copyright 2026 Glorktelligence — Harry Smith
# Licensed under the Apache License, Version 2.0

# ---------------------------------------------------------------------------
# Stage 1: Build
# ---------------------------------------------------------------------------
FROM node:24-slim AS build

RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

# Copy workspace config and lockfile first (cache layer)
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./

# Copy all package.json files for workspace resolution
COPY packages/protocol/package.json packages/protocol/
COPY packages/crypto/package.json packages/crypto/
COPY packages/relay/package.json packages/relay/
COPY packages/client-ai/package.json packages/client-ai/
COPY packages/client-human/package.json packages/client-human/
COPY packages/client-human-mobile/package.json packages/client-human-mobile/
COPY packages/relay-admin-ui/package.json packages/relay-admin-ui/
COPY packages/tests/package.json packages/tests/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/protocol/ packages/protocol/
COPY packages/relay-admin-ui/ packages/relay-admin-ui/

# Build protocol → admin UI
RUN pnpm --filter @bastion/protocol build && \
    pnpm --filter @bastion/relay-admin-ui build

# ---------------------------------------------------------------------------
# Stage 2: Runtime
# ---------------------------------------------------------------------------
FROM node:24-slim AS runtime

RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

COPY --from=build /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/package.json /app/tsconfig.base.json ./
COPY --from=build /app/node_modules/ node_modules/
COPY --from=build /app/packages/protocol/ packages/protocol/
COPY --from=build /app/packages/relay-admin-ui/ packages/relay-admin-ui/

USER node

EXPOSE 5174

WORKDIR /app/packages/relay-admin-ui

CMD ["pnpm", "dev", "--host", "0.0.0.0", "--port", "5174"]
