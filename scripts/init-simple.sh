#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# 🎉 Medical Patients Generator - Quick Setup (Dev Container Compatible)
# ─────────────────────────────────────────────────────────────────────────────

# Ensure we're running from the project root, not the scripts folder
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${SCRIPT_DIR}/.."
cd "${PROJECT_ROOT}"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
  echo -e "${GREEN}[INFO]${NC} $1"
}
warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log "Running Quick Setup (Dev Container Compatible)"

# Create .env if missing in project root
if [ ! -f .env ]; then
  log "Creating .env file in project root..."
  cat > .env << EOF
# Development Environment Variables
API_KEY=dev_secret_key_$(openssl rand -hex 16 2>/dev/null || echo 'please_change_me')
DEBUG=True
CORS_ORIGINS=http://localhost:8000,http://localhost:5174
DATABASE_URL=postgresql://medgen_user:medgen_password@localhost:5432/medgen_db
REDIS_URL=redis://localhost:6379/0
EOF
  log ".env file created"
else
  log "Using existing .env file"
fi

# In Dev Container, skip Docker Compose orchestration (host mode assumed)
if [ -f /.dockerenv ]; then
  warn "Detected Dev Container - skipping Docker Compose startup"
else
  log "Starting database services via Docker Compose..."
  docker compose pull db redis
  docker compose up -d db redis

  log "Waiting for database to be ready..."
  for i in {1..30}; do
    if docker compose exec -T db pg_isready -U medgen_user &> /dev/null; then
      break
    fi
    sleep 1
  done
fi

# Run migrations (if needed)
log "Applying Alembic migrations..."
alembic upgrade head 2>/dev/null || warn "Migration step failed - run manually later"

log "Quick setup complete!"

cat << EOF
Next steps:
  1. Run: task dev      # or ./run.sh inside container
  2. Visit: http://localhost:8000
environment details:
  • DATABASE_URL: $DATABASE_URL
  • REDIS_URL:    $REDIS_URL
EOF
