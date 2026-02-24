# Stage 1: Build
FROM oven/bun:1 AS builder
WORKDIR /app

# Install dependencies first for better layer caching
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
RUN bun install --frozen-lockfile

# Copy source code
COPY tsconfig.base.json ./
COPY apps/ apps/
COPY packages/ packages/

# Build the Vite frontend
RUN cd apps/web && bun run build

# Compile the Hono API server into a standalone binary
RUN bun build apps/api/src/index.ts --compile --outfile dist/api

# Stage 2: Runtime
FROM debian:bookworm-slim
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user
RUN useradd --system --create-home --shell /usr/sbin/nologin appuser

# Copy the compiled API binary
COPY --from=builder /app/dist/api ./api

# Copy the built static frontend assets
COPY --from=builder /app/apps/web/dist ./public

# Create the data directory for SQLite
RUN mkdir -p /app/data

# Own the working directory
RUN chown -R appuser:appuser /app

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

CMD ["./api"]
