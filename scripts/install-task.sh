#!/usr/bin/env bash
set -euo pipefail

# Task Runner Installation Script
# Installs 'task' on both native hosts and Dev Container environments

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if 'task' is already installed
if command -v task &> /dev/null; then
    EXISTING_VERSION=$(task --version 2>/dev/null | head -n1)
    print_warning "Task is already installed (${EXISTING_VERSION})"
    read -p "Reinstall/update? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_success "Using existing Task installation"
        exit 0
    fi
fi

# Install Task via official installer
print_status "Installing Task via official installer..."
curl -sL https://taskfile.dev/install.sh | sh

# Move binary to PATH if needed
if [ -f "./bin/task" ]; then
    print_status "Moving 'task' to /usr/local/bin"
    sudo mv ./bin/task /usr/local/bin/task
    sudo chmod +x /usr/local/bin/task
    rm -rf ./bin
fi

# Verify installation
if command -v task &> /dev/null; then
    print_success "Task installed successfully: $(task --version | head -n1)"
else
    print_error "Task installation failed. Please install manually: https://taskfile.dev/installation/"
    exit 1
fi

# Next steps
echo
print_status "Next steps:"
echo "  - Restart your shell or source your profile"
echo "  - Verify with: task --version"
echo "  - Create Taskfile.yml in your project root"
echo "  - Run: task --list to see available tasks"
echo "  - For this project: task init && task dev"
