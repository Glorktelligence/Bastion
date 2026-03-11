# Bastion AI Client — Docker Image
#
# Multi-stage build for the headless AI client.
# Connects to the relay and processes messages through the safety engine.
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
COPY packages/crypto/ packages/crypto/
COPY packages/client-ai/ packages/client-ai/

# Build protocol → crypto → client-ai (dependency order)
RUN pnpm --filter @bastion/protocol build && \
    pnpm --filter @bastion/crypto build && \
    pnpm --filter @bastion/client-ai build

# ---------------------------------------------------------------------------
# Stage 2: Runtime
# ---------------------------------------------------------------------------
FROM node:24-slim AS runtime

RUN corepack enable && corepack prepare pnpm@10 --activate

# Create non-root user
RUN useradd -r -m -s /bin/bash bastion-ai && \
    mkdir -p /var/lib/bastion-ai/intake /var/lib/bastion-ai/outbound && \
    chown -R bastion-ai:bastion-ai /var/lib/bastion-ai

WORKDIR /app

# Copy built application
COPY --from=build /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/package.json /app/tsconfig.base.json ./
COPY --from=build /app/node_modules/ node_modules/
COPY --from=build /app/packages/protocol/ packages/protocol/
COPY --from=build /app/packages/crypto/ packages/crypto/
COPY --from=build /app/packages/client-ai/ packages/client-ai/

# Copy entrypoint script
COPY packages/infrastructure/docker/entrypoints/ai-client-entrypoint.mjs ./entrypoint.mjs

USER bastion-ai

CMD ["node", "entrypoint.mjs"]
