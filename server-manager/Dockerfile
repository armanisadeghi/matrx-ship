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

# ── Stage 1: Build the Next.js admin UI (standalone mode) ─────────────────
FROM base AS admin-builder
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /build

# Copy workspace config for pnpm workspace resolution
COPY pnpm-workspace.yaml ./
COPY packages/admin-ui/package.json ./packages/admin-ui/

# Install shared package deps
WORKDIR /build/packages/admin-ui
COPY packages/admin-ui/ ./

# Install admin deps
WORKDIR /build/admin
COPY server-manager/admin/package.json server-manager/admin/pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install
COPY server-manager/admin/ ./
RUN pnpm build

# ── Stage 2: Final server image ──────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

# Express API server
COPY server-manager/package.json ./
RUN npm install --omit=dev

COPY server-manager/src/ ./src/
# Copy legacy public dir (favicons, manifest, etc.)
COPY server-manager/public/ ./public/

# Copy Next.js standalone build
COPY --from=admin-builder /build/admin/.next/standalone/admin/ ./admin/
COPY --from=admin-builder /build/admin/.next/static ./admin/.next/static
COPY --from=admin-builder /build/admin/public ./admin/public

# Startup script that runs both Express API and Next.js admin
COPY server-manager/start.sh ./start.sh
RUN chmod +x start.sh

EXPOSE 3000 3001

# Run as root to access Docker socket and host paths
CMD ["./start.sh"]
