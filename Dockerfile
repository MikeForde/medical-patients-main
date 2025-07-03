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

# 1) copy *everything* in your repo into /app
COPY . .

# 2) install deps
RUN pip install --no-cache-dir --upgrade pip setuptools wheel \
 && pip install --no-cache-dir -r requirements.txt


# Copy built timeline into a static folder
COPY --from=ui-builder /src/timeline/dist static/timeline

# Expose the port you’ll serve on
EXPOSE 8000

# 3) run migrations & start your API server
ENTRYPOINT ["sh", "-c"]
CMD ["alembic upgrade head && uvicorn src.main:app --host 0.0.0.0 --port 8000"]

    

