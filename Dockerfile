# syntax=docker/dockerfile:1.7
# Build stage: install all deps, compile with tsdown, prune to prod-only deps.
FROM node:24-bookworm-slim AS builder
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json tsdown.config.ts ./
COPY src ./src
RUN pnpm build && pnpm prune --prod

# Runtime stage: debian-slim with just node + prod node_modules + dist.
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

USER node
ENTRYPOINT ["node", "/app/dist/cli.js"]
