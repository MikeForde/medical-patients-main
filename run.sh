#!/usr/bin/env bash
set -euo pipefail

# Detect Dev Container
IN_CONTAINER=false
if [ -f /.dockerenv ]; then
  IN_CONTAINER=true
  echo -e "\033[0;34mℹ️  Detected Dev Container – skipping virtual-env setup\033[0m"
fi

echo "Medical Patients Generator - Quick Start"
echo "========================================"

if ! $IN_CONTAINER; then
  # Host: ensure virtualenv
  if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
  fi
  echo "Activating virtual environment..."
  # shellcheck disable=SC1091
  source venv/bin/activate
fi

# Check for FastAPI
if ! python -c "import fastapi" 2>/dev/null; then
  if $IN_CONTAINER; then
    echo -e "\033[0;33m⚠️  FastAPI not found in container – please rerun setup-dev.sh inside the container\033[0m"
    exit 1
  else
    echo "Installing dependencies in venv..."
    pip install -r requirements.txt
  fi
fi

echo ""
echo "Starting application..."
echo "• Access the application at: http://localhost:8000"
echo "• API docs:              http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop"
echo ""

python -m src.main
