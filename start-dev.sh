#!/bin/bash

# Medical Patient Generator - Enhanced Development Environment Setup
# This script sets up the development environment with hardening and self-testing
# Compatible with the refactored domain-driven architecture

# Exit on any error and enable strict error handling
set -euo pipefail

# Load .env into the environment
if [ -f ".env" ]; then
  echo "Loading .env variables…"
  # export each KEY=VALUE
  set -o allexport
  # shellcheck disable=SC1091
  source .env
  set +o allexport
fi

# Detect container
IN_CONTAINER=false
if [ -f /.dockerenv ]; then
    IN_CONTAINER=true
    echo -e "\033[0;34mℹ️  Detected Dev Container – skipping host orchestration steps\033[0m"
fi

# Logging and color support
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
API_KEY="${API_KEY:-bUXPV0bRJp1rU40EMaVDyUgFw1aafsn}"
MAX_HEALTH_RETRIES=30
HEALTH_CHECK_INTERVAL=5
TEST_TIMEOUT=60

# Utility functions
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

log_step() {
    echo -e "${PURPLE}🚀 $1${NC}"
    echo "$(printf '%.0s-' {1..70})"
}

# Environment validation
validate_environment() {
    log_step "Validating Environment"

    # Check if we're in the correct directory
    if [[ ! -f "package.json" ]] || [[ ! -f "requirements.txt" ]]; then
        log_error "This script must be run from the project root directory"
        log_info "Expected files: package.json, requirements.txt"
        exit 1
    fi

    # Check for critical configuration files
    if [[ ! -f "alembic.ini" ]]; then
        log_error "alembic.ini not found - database migrations may not work"
        exit 1
    fi

    if [[ ! -d "src" ]]; then
        log_error "src/ directory not found - new architecture not detected"
        exit 1
    fi

    # Validate API key
    if [[ "$API_KEY" == "bUXPV0bRJp1rU40EMaVDyUgFw1aafsn" ]]; then
        log_warning "Using default API key - change API_KEY environment variable for production"
    fi

    log_success "Environment validation passed"
}

# Install and update dependencies
install_dependencies() {
    log_step "Installing Dependencies"

    # Frontend dependencies
    log_info "Installing/updating frontend dependencies..."
    npm ci --silent
    log_success "Frontend dependencies installed"

    # Check for Python dependencies (for local development)
    if [[ "${INSTALL_PYTHON_DEPS:-false}" == "true" ]]; then
        log_info "Installing Python dependencies locally..."
        if command -v pip &>/dev/null; then
            pip install -r requirements.txt --quiet
            log_success "Python dependencies installed"
        else
            log_warning "pip not found - skipping Python dependencies (will use Docker)"
        fi
    fi
}

# Build frontend assets
build_frontend() {
    log_step "Building Frontend Assets"

    if ! grep -q '"build:all-frontend"' package.json; then
        log_warning "No frontend build script defined – skipping frontend build"
        return 0
    fi

    log_info "Building all frontend components..."
    npm run build:all-frontend

    # Verify build outputs
    if [[ ! -d "static/dist" ]]; then
        log_warning "static/dist not created by build – creating empty directory"
        mkdir -p static/dist
    fi

    # Check for key build artifacts
    local expected_files=("static/dist/configuration-panel.js" "static/dist/bundle.js" "static/dist/military-dashboard-bundle.js")
    for file in "${expected_files[@]}"; do
        if [[ ! -f "$file" ]]; then
            log_warning "Expected build artifact not found: $file"
        fi
    done

    log_success "Frontend assets step complete"
}

# Start Docker services
start_services() {
    log_step "Starting Docker Services"

    if $IN_CONTAINER; then
        log_info "Inside container – skip start_services (run on host)"
        return
    fi
}

# Run database migrations
run_migrations() {
    log_step "Running Database Migrations"
    log_info "Applying Alembic migrations..."
    if ! alembic upgrade head; then
        log_error "Database migration failed"
        exit 1
    fi
    log_success "Database migrations completed"
}

# Self-testing functionality
run_self_tests() {
    log_step "Running Self-Tests"

    local base_url="http://localhost:8000"

    # Test 1: Health endpoint
    log_info "Testing health endpoint..."
    if timeout $TEST_TIMEOUT curl -sf "$base_url/health" &>/dev/null; then
        log_success "Health endpoint responsive"
    else
        log_error "Health endpoint failed"
        return 1
    fi

    # Test 2: API documentation
    log_info "Testing API documentation..."
    if timeout $TEST_TIMEOUT curl -sf "$base_url/docs" &>/dev/null; then
        log_success "API documentation accessible"
    else
        log_warning "API documentation not accessible"
    fi

    # Test 3: Static assets
    log_info "Testing static assets..."
    if timeout $TEST_TIMEOUT curl -sf "$base_url/static/index.html" &>/dev/null; then
        log_success "Main UI accessible"
    else
        log_error "Main UI not accessible"
        return 1
    fi

    # Test 4: API with authentication
    log_info "Testing authenticated API endpoint..."
    if timeout $TEST_TIMEOUT curl -sf -H "X-API-Key: $API_KEY" "$base_url/api/v1/configurations/reference/nationalities/" &>/dev/null; then
        log_success "Authenticated API endpoints working"
    else
        log_error "Authenticated API endpoints failed"
        return 1
    fi

    # Test 5: Database connectivity (via API)
    log_info "Testing database connectivity..."
    if timeout $TEST_TIMEOUT curl -sf -H "X-API-Key: $API_KEY" "$base_url/api/v1/configurations/" &>/dev/null; then
        log_success "Database connectivity confirmed"
    else
        log_error "Database connectivity failed"
        return 1
    fi

    log_success "All self-tests passed!"
    return 0
}

# Performance and security checks
run_hardening_checks() {
    log_step "Running Hardening Checks"

    # Check for default credentials
    if [[ "$API_KEY" == "bUXPV0bRJp1rU40EMaVDyUgFw1aafsn" ]]; then
        log_warning "SECURITY: Default API key detected - change for production!"
    fi

    log_success "Hardening checks completed"
}

# Generate development data (optional)
generate_test_data() {
    if [[ "${GENERATE_TEST_DATA:-false}" == "true" ]]; then
        log_step "Generating Test Data"

        local base_url="http://localhost:8000"

        log_info "Creating test configuration..."
        local config_response
        config_response=$(curl -sf -X POST "$base_url/api/v1/configurations/" \
            -H "X-API-Key: $API_KEY" \
            -H "Content-Type: application/json" \
            -d '{
                "name": "Development Test Configuration",
                "description": "Auto-generated test configuration for development",
                "total_patients": 5,
                "front_configs": [{
                    "id": "dev-front",
                    "name": "Development Front",
                    "casualty_rate": 1.0,
                    "nationality_distribution": [{"nationality_code": "USA", "percentage": 100.0}]
                }],
                "facility_configs": [{
                    "id": "POI",
                    "name": "Point of Injury",
                    "kia_rate": 0.1,
                    "rtd_rate": 0.0
                }],
                "injury_distribution": {
                    "Disease": 50.0,
                    "Non-Battle Injury": 30.0,
                    "Battle Injury": 20.0
                }
            }' 2>/dev/null) || {
            log_warning "Failed to create test configuration"
            return 0
        }

        local config_id
        config_id=$(echo "$config_response" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

        if [[ -n "$config_id" ]]; then
            log_info "Generating test patients with configuration: $config_id"
            curl -sf -X POST "$base_url/api/generate" \
                -H "X-API-Key: $API_KEY" \
                -H "Content-Type: application/json" \
                -d "{\"configuration_id\": \"$config_id\", \"output_formats\": [\"json\"]}" &>/dev/null || {
                log_warning "Failed to generate test patients"
                return 0
            }
            log_success "Test data generation initiated"
        fi
    fi
}

# Print startup summary
print_summary() {
    log_step "Development Environment Ready!"

    echo -e "${CYAN}"
    echo "🔗 Application URLs:"
    echo "   • Main Application:      http://localhost:8000/static/index.html"
    echo "   • Visualization Dashboard: http://localhost:8000/static/visualizations.html"
    echo "   • API Documentation:     http://localhost:8000/docs"
    echo "   • Alternative API Docs:  http://localhost:8000/redoc"
    echo "   • Health Check:          http://localhost:8000/health"
    echo ""
    echo "🔑 Authentication:"
    echo "   • API Key: $API_KEY"
    echo ""
    echo "🛠️  Development Commands:"
    echo "   • View logs:            make logs"
    echo "   • Run tests:            make test"
    echo "   • Stop services:        make down"
    echo "   • Clean restart:        make clean && make dev"
    echo "   • Generate test data:   make generate-test"
    echo ""
    echo "📊 Service Status:"
    echo -e "${NC}"
}

# Cleanup function for script exit
cleanup_on_exit() {
    local exit_code=$?
    if [[ $exit_code -ne 0 ]]; then
        log_error "Setup failed with exit code $exit_code"
    fi
}

# Main execution
main() {
    trap cleanup_on_exit EXIT

    log_step "Medical Patient Generator - Development Environment Setup"
    log_info "Refactored architecture with hardening and self-testing"
    echo ""

    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
        --test-data)
            GENERATE_TEST_DATA=true
            shift
            ;;
        --skip-tests)
            SKIP_SELF_TESTS=true
            shift
            ;;
        -h | --help)
            echo "Usage: $0 [OPTIONS]"
            echo "Options:"
            echo "  --test-data    Generate test data after setup"
            echo "  --skip-tests   Skip self-testing phase"
            echo "  -h, --help     Show this help message"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
        esac
    done

    # Execute setup steps
    validate_environment
    install_dependencies
    build_frontend
    start_services
    run_migrations
    run_hardening_checks

    # Run self-tests unless skipped
    if [[ "${SKIP_SELF_TESTS:-false}" != "true" ]]; then
        if ! run_self_tests; then
            log_error "Self-tests failed - environment may not be fully functional"
            exit 1
        fi
    fi

    # Generate test data if requested
    generate_test_data

    # Success!
    print_summary
    log_success "Development environment is ready and tested!"
}

# Execute main function with all arguments
main "$@"
