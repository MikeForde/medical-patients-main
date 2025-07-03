# 1) Build stage for timeline viewer
FROM node:22-alpine AS ui-builder
WORKDIR /src/timeline
COPY patient-timeline-viewer/package*.json ./
RUN npm ci
COPY patient-timeline-viewer/ ./
RUN npm run build

# 2) Final stage: Python + static
FROM image-registry.openshift-image-registry.svc:5000/openshift/python@sha256:6f6592717b9d88dc1ace1c4c144cfcbf59afa288edeb3cdd7a79d6d2f7467a11

WORKDIR /app

# Copy Python requirements & install
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip setuptools wheel \
 && pip install --no-cache-dir -r requirements.txt

# Copy Python application code
COPY src/ src/
COPY patient_generator/ patient_generator/
COPY static/ static/
COPY config.py .


# Copy built React into static folder
COPY --from=ui-builder /src/timeline/dist static/timeline

# Env defaults
ENV HOST=0.0.0.0 \
    PORT=8000 \
    DATABASE_URL=postgresql://medgen_user:medgen_password@postgres:5432/medgen_db \
    REDIS_URL=redis://redis:6379/0

# Run migrations then start server
ENTRYPOINT []
CMD ["sh", "-c", "uvicorn src.main:app --host ${HOST} --port ${PORT}"]
