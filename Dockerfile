# 1) Build stage for timeline viewer
FROM node:22-alpine AS ui-builder
WORKDIR /src/timeline
COPY patient-timeline-viewer/package*.json ./
RUN npm ci
COPY patient-timeline-viewer/ ./
RUN npm run build

# 2) Final stage: Python + static
FROM python:3.10-slim
WORKDIR /app

# Install OS deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev \
  && rm -rf /var/lib/apt/lists/*

# Copy Python code
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ src/
COPY alembic_migrations/ alembic_migrations/

# Copy built React into FastAPI’s static folder
COPY --from=ui-builder /src/timeline/dist static/timeline

# Expose port and set env
ENV PORT=8000 HOST=0.0.0.0
ENV DATABASE_URL=postgresql://medgen_user:medgen_password@postgresql:5432/medgen_db
ENV REDIS_URL=redis://redis-service:6379/0

# Run migrations then start
CMD alembic upgrade head \
 && uvicorn src.main:app \
      --host ${HOST} --port ${PORT} \
      --root-path "" 
