# ── Server Manager Dockerfile ─────────────────────────────────────────
# Build context: monorepo root (.)
# Usage: docker build -f server-manager/Dockerfile .

FROM node:22-slim AS base

# Install system tools + prerequisites for Docker CLI + git
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    procps \
    iproute2 \
    dnsutils \
    net-tools \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install Docker CLI (not the daemon — just the client to talk to the host's Docker socket)
RUN install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && chmod a+r /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" \
    > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce-cli docker-buildx-plugin docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

# Install AWS CLI v2
RUN curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "/tmp/awscliv2.zip" \
    && apt-get update && apt-get install -y --no-install-recommends unzip \
    && unzip /tmp/awscliv2.zip -d /tmp \
    && /tmp/aws/install \
    && rm -rf /tmp/awscliv2.zip /tmp/aws /var/lib/apt/lists/*

# ── Stage 1: Build the Next.js admin UI (standalone mode) ─────────────
FROM base AS admin-builder
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /build

# Copy workspace config and lockfile
COPY pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy all workspace package.json files needed
COPY packages/admin-ui/package.json ./packages/admin-ui/
COPY server-manager/admin/package.json ./server-manager/admin/

# Install all workspace deps for the admin app
RUN pnpm install --frozen-lockfile --filter matrx-admin... 2>/dev/null || pnpm install --filter matrx-admin...

# Copy shared package source
COPY packages/admin-ui/ ./packages/admin-ui/

# Copy admin app source and build
COPY server-manager/admin/ ./server-manager/admin/
WORKDIR /build/server-manager/admin
RUN pnpm build

# ── Stage 2: Final server image ──────────────────────────────────────
FROM base AS runner
WORKDIR /app

# Express API server
COPY server-manager/package.json ./
RUN npm install --omit=dev

COPY server-manager/src/ ./src/
# Copy legacy public dir (favicons, manifest, etc.)
COPY server-manager/public/ ./public/

# Copy the full Next.js standalone output (preserves pnpm node_modules structure)
COPY --from=admin-builder /build/server-manager/admin/.next/standalone/ ./admin/
# Copy static assets into the admin app subdirectory
COPY --from=admin-builder /build/server-manager/admin/.next/static ./admin/server-manager/admin/.next/static
# Copy public assets (logo SVG, etc.) into the admin app subdirectory
COPY --from=admin-builder /build/server-manager/admin/public ./admin/server-manager/admin/public

# Startup script that runs both Express API and Next.js admin
COPY server-manager/start.sh ./start.sh
RUN chmod +x start.sh

EXPOSE 3000 3001

# Run as root to access Docker socket and host paths
CMD ["./start.sh"]
