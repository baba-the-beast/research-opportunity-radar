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
RUN npm run build

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

WORKDIR /app/web

# Environment configurations
ENV PYTHONPATH=/app
ENV PROJECT_ROOT=/app
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Start Next.js production server
CMD ["npm", "run", "start"]
