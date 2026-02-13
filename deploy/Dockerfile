# ── Deploy Service Dockerfile ──────────────────────────────────────────
# Build context: monorepo root (.)
# Usage: docker build -f deploy/Dockerfile .

FROM node:22-alpine AS base

# Install Docker CLI (with buildx), git, and AWS CLI
RUN apk add --no-cache docker-cli docker-cli-buildx docker-cli-compose git curl aws-cli

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

# ── Stage 1: Install all workspace dependencies ─────────────────────
FROM base AS deps
WORKDIR /build

# Copy workspace config and lockfile
COPY pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy all workspace package.json files for dependency resolution
COPY deploy/package.json ./deploy/
COPY packages/admin-ui/package.json ./packages/admin-ui/

# Install all workspace deps from the root
RUN pnpm install --frozen-lockfile --filter matrx-deploy... 2>/dev/null || pnpm install --filter matrx-deploy...

# ── Stage 2: Build ───────────────────────────────────────────────────
FROM deps AS builder
WORKDIR /build

# Copy shared package source
COPY packages/admin-ui/ ./packages/admin-ui/

# Copy deploy app source
COPY deploy/ ./deploy/

# Build the deploy app
WORKDIR /build/deploy
RUN pnpm build

# ── Stage 3: Runner ──────────────────────────────────────────────────
FROM node:22-alpine AS runner

# Install Docker CLI (with buildx), git, and AWS CLI
RUN apk add --no-cache docker-cli docker-cli-buildx docker-cli-compose git curl aws-cli

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Copy the full standalone output (preserves monorepo directory structure)
COPY --from=builder /build/deploy/.next/standalone/ ./
# Copy static assets and public files into the deploy subdirectory
COPY --from=builder /build/deploy/.next/static ./deploy/.next/static
COPY --from=builder /build/deploy/public ./deploy/public

EXPOSE 3000

# The standalone server.js is inside the workspace subdirectory
WORKDIR /app/deploy
CMD ["node", "server.js"]
