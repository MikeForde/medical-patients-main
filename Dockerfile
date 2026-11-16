# 1) Build stage for timeline viewer
FROM image-registry.openshift-image-registry.svc:5000/uksc-medsnomed-medsno/node:22-alpine AS ui-builder
WORKDIR /src/timeline
COPY patient-timeline-viewer/package*.json ./
RUN npm ci
COPY patient-timeline-viewer/ ./
RUN npm run build

# 2) Final stage: Python 3.12 / RHEL 9.9
FROM registry.redhat.io/ubi9/python-312@sha256:5b184c2acfe9e2eb9df1a243da8e4a82fedd96e5e7f6648ec5512656177fa326

# Verify security fixes in the base image
USER root

RUN rpm -q openssl-libs mariadb-connector-c libbrotli \
 && rpm -q --changelog openssl-libs | grep 'CVE-2026-45445' \
 && rpm -q --changelog mariadb-connector-c | grep 'CVE-2026-44172' \
 && rpm -q --changelog libbrotli | grep 'CVE-2026-111497'

WORKDIR /app

# Create writable output & temp directories for any non-root UID
USER root
RUN mkdir -p output temp \
 && chmod -R 0777 output temp
USER 1001

# Copy Python requirements & install
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip setuptools wheel \
 && pip install --no-cache-dir -r requirements.txt

# Copy Python application code
COPY src/ src/
COPY patient_generator/ patient_generator/
USER root
RUN chmod -R g+w /app/patient_generator
USER 1001
COPY static/ static/
COPY config.py .


# Copy built React into static folder
COPY --from=ui-builder /src/timeline/dist static/timeline

# Env defaults
ENV HOST=0.0.0.0 \
    PORT=8000 \
    DATABASE_URL=postgresql://medgen_user:medgen_password@postgres:5432/medgen_db \
    REDIS_URL=redis://redis:6379/0

# start server
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
