# =============================================================================
# Open Valley - legacy Warren housing application
#
# Retained for data rebuilds, not part of the public runtime. The live site
# builds from deploy/Dockerfile.web. See docs/housing-baseline.md.
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Node.js builder for Next.js frontend
# -----------------------------------------------------------------------------
FROM node:20-alpine AS frontend-builder

WORKDIR /app/web

# Install dependencies first (better layer caching)
COPY web/package.json web/package-lock.json* ./
RUN npm ci --only=production=false

# Copy Next.js source and build
COPY web/ ./

# Set production environment for build optimization
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Build Next.js static files
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 2: Python builder for dependencies
# -----------------------------------------------------------------------------
FROM python:3.11-slim AS python-builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install uv for fast Python package management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy Python project files
COPY pyproject.toml ./
COPY uv.lock* ./

# Create virtual environment and install dependencies
RUN uv venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"
RUN uv sync --frozen --no-dev

# -----------------------------------------------------------------------------
# Stage 3: Production runtime
# -----------------------------------------------------------------------------
FROM python:3.11-slim AS runtime

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    nodejs \
    npm \
    supervisor \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy Python virtual environment from builder
COPY --from=python-builder /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONPATH="/app"

# Copy FastAPI application source
COPY src/ /app/src/

# Copy Next.js production build and dependencies
COPY --from=frontend-builder /app/web/.next /app/web/.next
COPY --from=frontend-builder /app/web/public /app/web/public
COPY --from=frontend-builder /app/web/package.json /app/web/package.json
COPY --from=frontend-builder /app/web/node_modules /app/web/node_modules

# Copy Next.js config files needed at runtime
COPY web/next.config.ts /app/web/

# Create supervisord configuration
RUN mkdir -p /etc/supervisor/conf.d /var/log/supervisor

COPY <<'EOF' /etc/supervisor/conf.d/openvalley.conf
[supervisord]
nodaemon=true
logfile=/var/log/supervisor/supervisord.log
pidfile=/var/run/supervisord.pid
loglevel=info

[program:api]
command=/app/.venv/bin/uvicorn src.main:app --host 0.0.0.0 --port 8999
directory=/app
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
environment=PYTHONPATH="/app"

[program:web]
command=npm run start -- -p 3000
directory=/app/web
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
environment=NODE_ENV="production"
EOF

# Expose ports
# 8999 - FastAPI backend
# 3000 - Next.js frontend
EXPOSE 8999 3000

# Health check for the API
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8999/ || exit 1

# Start supervisord to manage both processes
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/openvalley.conf"]
