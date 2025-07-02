#!/usr/bin/env bash
set -euo pipefail

# Non-interactive Init Setup for Medical Patients Generator (Dev Container)
# Assumes Python 3.10+, Node 22+, Docker host networking

# Navigate to project root (script in scripts/ folder)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}/.."

# Create .env if missing
if [ ! -f .env ]; then
  cat > .env <<EOF
# Development Environment Variables
API_KEY=dev_secret_key_$(openssl rand -hex 16 2>/dev/null || echo 'change_me')
DEBUG=True
CORS_ORIGINS=http://localhost:8000,http://localhost:5174
DATABASE_URL=postgresql://medgen_user:medgen_password@localhost:5432/medgen_db
REDIS_URL=redis://localhost:6379/0
EOF
  echo "[INFO] Created .env file"
else
  echo "[INFO] .env already exists"
fi

# Install Python dependencies
echo "[INFO] Installing Python dependencies..."
python3 -m pip install --upgrade pip setuptools wheel
python3 -m pip install -r requirements.txt

# Install Node.js dependencies
echo "[INFO] Installing Node.js dependencies..."
npm ci --silent

# Apply database migrations
echo "[INFO] Applying Alembic migrations..."
alembic upgrade head

# Optional: quick health check
echo "[INFO] Testing application health..."
nohup python3 -m uvicorn src.main:app --host 0.0.0.0 --port 8000 &>/dev/null &
APP_PID=$!
sleep 3
if curl -sf http://localhost:8000/health &>/dev/null; then
  echo "[SUCCESS] Application health check passed"
else
  echo "[ERROR] Application health check failed"
  kill $APP_PID 2>/dev/null || true
  exit 1
fi
kill $APP_PID 2>/dev/null || true

echo "[INFO] Non-interactive setup complete."
echo "Next: Run 'task dev' to start the full development environment."
