#!/usr/bin/env bash
set -euo pipefail

# Init Setup for Medical Patients Generator (Dev Container)
# Assumes Python 3.10+ and Node 22+ are pre-installed by the devcontainer

# Navigate to project root (script located in scripts/ directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}/.."

echo "[INFO] Starting init-setup..."

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
  echo "[INFO] .env file created"
else
  echo "[INFO] .env file already exists"
fi

# Install Python dependencies
echo "[INFO] Installing Python dependencies..."
pip install --upgrade pip
pip install -r requirements.txt

# Install Node.js dependencies
echo "[INFO] Installing Node.js dependencies..."
npm ci

# Apply database migrations
echo "[INFO] Applying database migrations..."
alembic upgrade head

echo "[INFO] Init setup complete."
echo "Next steps:"
echo "  - Run: task dev    # Start development server"
echo "  - Access at: http://localhost:8000"
