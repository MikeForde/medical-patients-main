# 1) Build stage for timeline viewer
FROM node:22-alpine AS ui-builder
WORKDIR /src/timeline
COPY patient-timeline-viewer/package*.json ./
RUN npm ci
COPY patient-timeline-viewer/ ./
RUN npm run build

# 2) Final stage: Python + static
FROM python:3.11-slim

WORKDIR /app

# Rewrite APT sources to use HTTPS (avoids HTTP 470 errors in OpenShift build)
RUN apt-get update && apt-get install -y \
      git \
      libpq-dev gcc \
      && rm -rf /var/lib/apt/lists/*S

# Copy Python requirements & install
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip setuptools wheel \
 && pip install --no-cache-dir -r requirements.txt

# Copy application code & migrations
COPY src/ src/
COPY alembic_migrations/ alembic_migrations/

# Copy built React into static folder
COPY --from=ui-builder /src/timeline/dist static/timeline

# Env defaults
ENV HOST=0.0.0.0 \
    PORT=8000 \
    DATABASE_URL=postgresql://medgen_user:medgen_password@postgres-service:5432/medgen_db \
    REDIS_URL=redis://redis-service:6379/0

# Run migrations then start server
CMD alembic upgrade head \
 && uvicorn src.main:app --host ${HOST} --port ${PORT}