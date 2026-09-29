# ==============================================================================
# Research Opportunity Radar - Multi-Runtime Container (Path A)
# Co-locates Python 3.11 (Pipeline & ML agents) + Node.js 20 (Next.js Dashboard)
# Recommended container memory: 2 GB RAM (minimum 1 GB RAM for PyTorch/Transformers)
# ==============================================================================

# Stage 1: Build the Next.js dashboard
FROM node:20-slim AS frontend-builder
WORKDIR /app/web
COPY web/package.json web/package-lock.json* ./
RUN npm ci --prefer-offline --no-audit
COPY web/ ./
# NEXT_PUBLIC_* values are inlined into the browser bundle at build time, so they must be present
# here (Render passes service env vars to declared build ARGs). Without them the browser Supabase
# client is built with placeholders and login cannot work.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL     NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
RUN npm run build
# Ship only runtime dependencies (drops typescript, vitest, tailwind build tooling)
RUN npm prune --omit=dev

# Stage 2: Production runtime with Python 3.11 + Node.js 20
FROM python:3.11-slim

# Install system dependencies and Node.js 20 LTS
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    build-essential \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Set ML model cache directory
ENV HF_HOME=/app/.cache/huggingface
ENV TRANSFORMERS_CACHE=/app/.cache/huggingface

# Install Python ML and pipeline dependencies
# Explicitly install CPU-only PyTorch first to prevent downloading 3-4GB of CUDA/GPU wheels
COPY requirements.txt .
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.txt

# Pre-cache SentenceTransformer model weights into container layer
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')"

# Copy Python modules & configuration
COPY radar/ ./radar/
COPY pyproject.toml ./
COPY mcp_server.py ./

# Copy built frontend application
COPY --from=frontend-builder /app/web /app/web

# Create non-root system user and transfer file ownership
RUN groupadd -g 1001 appgroup && \
    useradd -u 1001 -g appgroup -s /bin/bash -m appuser && \
    chown -R appuser:appgroup /app

USER appuser

WORKDIR /app/web

# Environment configurations
ENV PYTHONPATH=/app
ENV PROJECT_ROOT=/app
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Container liveness healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:3000/api/health/live || exit 1

# Start Next.js production server
CMD ["npm", "run", "start"]
