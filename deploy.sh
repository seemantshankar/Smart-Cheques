#!/bin/bash

# Smart Cheques Production Deployment Script
# This script handles the complete deployment process for the Smart Cheques platform

set -e  # Exit on any error

# =============================================================================
# CONFIGURATION
# =============================================================================

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
ENVIRONMENT="production"
SKIP_TESTS=false
SKIP_BUILD=false
SKIP_MIGRATIONS=false
FORCE_REBUILD=false
BACKUP_DB=true
DRY_RUN=false

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

show_usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Options:
    -e, --environment ENV     Deployment environment (production, staging, development)
    -s, --skip-tests         Skip running tests
    -b, --skip-build         Skip building Docker images
    -m, --skip-migrations    Skip database migrations
    -f, --force-rebuild      Force rebuild of all images
    -n, --no-backup         Skip database backup
    -d, --dry-run           Show what would be done without executing
    -h, --help              Show this help message

Examples:
    $0                                    # Full production deployment
    $0 -e staging                         # Deploy to staging
    $0 --skip-tests --force-rebuild       # Skip tests and force rebuild
    $0 --dry-run                          # Preview deployment steps

EOF
}

check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check if Docker is installed and running
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    if ! docker info &> /dev/null; then
        log_error "Docker is not running. Please start Docker first."
        exit 1
    fi
    
    # Check if Docker Compose is available
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        log_error "Docker Compose is not available. Please install Docker Compose."
        exit 1
    fi
    
    # Check if .env file exists
    if [[ ! -f ".env.${ENVIRONMENT}" ]]; then
        log_error "Environment file .env.${ENVIRONMENT} not found."
        log_info "Please create .env.${ENVIRONMENT} based on .env.example"
        exit 1
    fi
    
    # Check if required environment variables are set
    source ".env.${ENVIRONMENT}"
    
    required_vars=("DB_PASSWORD" "JWT_SECRET" "RPC_URL" "FACTORY_ADDRESS")
    for var in "${required_vars[@]}"; do
        if [[ -z "${!var}" ]]; then
            log_error "Required environment variable $var is not set in .env.${ENVIRONMENT}"
            exit 1
        fi
    done
    
    log_success "Prerequisites check passed"
}

run_tests() {
    if [[ "$SKIP_TESTS" == "true" ]]; then
        log_warning "Skipping tests"
        return 0
    fi
    
    log_info "Running tests..."
    
    # Run smart contract tests
    log_info "Running smart contract tests..."
    if [[ "$DRY_RUN" == "false" ]]; then
        npm test
    fi
    
    # Run backend tests
    log_info "Running backend tests..."
    if [[ "$DRY_RUN" == "false" ]]; then
        cd src && npm test && cd ..
    fi
    
    # Run frontend tests
    log_info "Running frontend tests..."
    if [[ "$DRY_RUN" == "false" ]]; then
        cd frontend && npm test -- --watchAll=false && cd ..
    fi
    
    log_success "All tests passed"
}

backup_database() {
    if [[ "$BACKUP_DB" == "false" ]]; then
        log_warning "Skipping database backup"
        return 0
    fi
    
    log_info "Creating database backup..."
    
    if [[ "$DRY_RUN" == "false" ]]; then
        # Create backup directory
        mkdir -p backups
        
        # Generate backup filename with timestamp
        backup_file="backups/smartcheques_backup_$(date +%Y%m%d_%H%M%S).sql"
        
        # Create database backup
        docker-compose -f docker-compose.prod.yml exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" > "$backup_file"
        
        log_success "Database backup created: $backup_file"
    else
        log_info "Would create database backup"
    fi
}

build_images() {
    if [[ "$SKIP_BUILD" == "true" ]]; then
        log_warning "Skipping image build"
        return 0
    fi
    
    log_info "Building Docker images..."
    
    build_args=""
    if [[ "$FORCE_REBUILD" == "true" ]]; then
        build_args="--no-cache"
    fi
    
    if [[ "$DRY_RUN" == "false" ]]; then
        # Build images
        docker-compose -f docker-compose.prod.yml build $build_args
    else
        log_info "Would build Docker images with args: $build_args"
    fi
    
    log_success "Docker images built successfully"
}

run_migrations() {
    if [[ "$SKIP_MIGRATIONS" == "true" ]]; then
        log_warning "Skipping database migrations"
        return 0
    fi
    
    log_info "Running database migrations..."
    
    if [[ "$DRY_RUN" == "false" ]]; then
        # Wait for database to be ready
        log_info "Waiting for database to be ready..."
        docker-compose -f docker-compose.prod.yml up -d postgres
        
        # Wait for postgres to be healthy
        timeout=60
        while [[ $timeout -gt 0 ]]; do
            if docker-compose -f docker-compose.prod.yml exec postgres pg_isready -U "$DB_USER" -d "$DB_NAME" &> /dev/null; then
                break
            fi
            sleep 2
            ((timeout-=2))
        done
        
        if [[ $timeout -le 0 ]]; then
            log_error "Database failed to become ready within 60 seconds"
            exit 1
        fi
        
        # Run migrations
        for migration in src/migrations/*.sql; do
            if [[ -f "$migration" ]]; then
                log_info "Running migration: $(basename "$migration")"
                docker-compose -f docker-compose.prod.yml exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" < "$migration"
            fi
        done
    else
        log_info "Would run database migrations"
    fi
    
    log_success "Database migrations completed"
}

deploy_services() {
    log_info "Deploying services..."
    
    if [[ "$DRY_RUN" == "false" ]]; then
        # Copy environment file
        cp ".env.${ENVIRONMENT}" .env
        
        # Deploy services
        docker-compose -f docker-compose.prod.yml up -d
        
        # Wait for services to be healthy
        log_info "Waiting for services to be healthy..."
        timeout=120
        while [[ $timeout -gt 0 ]]; do
            if docker-compose -f docker-compose.prod.yml ps | grep -q "(healthy)"; then
                break
            fi
            sleep 5
            ((timeout-=5))
        done
        
        if [[ $timeout -le 0 ]]; then
            log_warning "Some services may not be healthy yet. Check with 'docker-compose ps'"
        fi
    else
        log_info "Would deploy services using docker-compose.prod.yml"
    fi
    
    log_success "Services deployed successfully"
}

verify_deployment() {
    log_info "Verifying deployment..."
    
    if [[ "$DRY_RUN" == "false" ]]; then
        # Check service status
        log_info "Service status:"
        docker-compose -f docker-compose.prod.yml ps
        
        # Test backend health endpoint
        log_info "Testing backend health..."
        if curl -f "http://localhost:${BACKEND_PORT:-3001}/health" &> /dev/null; then
            log_success "Backend is healthy"
        else
            log_warning "Backend health check failed"
        fi
        
        # Test frontend
        log_info "Testing frontend..."
        if curl -f "http://localhost:${FRONTEND_PORT:-3000}" &> /dev/null; then
            log_success "Frontend is accessible"
        else
            log_warning "Frontend accessibility check failed"
        fi
    else
        log_info "Would verify deployment health"
    fi
    
    log_success "Deployment verification completed"
}

cleanup() {
    log_info "Cleaning up..."
    
    if [[ "$DRY_RUN" == "false" ]]; then
        # Remove unused images
        docker image prune -f
        
        # Remove unused volumes (be careful with this in production)
        # docker volume prune -f
    else
        log_info "Would clean up unused Docker resources"
    fi
    
    log_success "Cleanup completed"
}

show_deployment_info() {
    log_info "Deployment Information:"
    echo "Environment: $ENVIRONMENT"
    echo "Frontend URL: http://localhost:${FRONTEND_PORT:-3000}"
    echo "Backend URL: http://localhost:${BACKEND_PORT:-3001}"
    echo "Database: PostgreSQL on port ${DB_PORT:-5432}"
    echo "Redis: Redis on port ${REDIS_PORT:-6379}"
    
    if [[ "$DRY_RUN" == "false" ]]; then
        echo ""
        log_info "Useful commands:"
        echo "  View logs: docker-compose -f docker-compose.prod.yml logs -f [service]"
        echo "  Stop services: docker-compose -f docker-compose.prod.yml down"
        echo "  Restart service: docker-compose -f docker-compose.prod.yml restart [service]"
        echo "  Scale service: docker-compose -f docker-compose.prod.yml up -d --scale [service]=[count]"
    fi
}

# =============================================================================
# MAIN EXECUTION
# =============================================================================

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -e|--environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -s|--skip-tests)
            SKIP_TESTS=true
            shift
            ;;
        -b|--skip-build)
            SKIP_BUILD=true
            shift
            ;;
        -m|--skip-migrations)
            SKIP_MIGRATIONS=true
            shift
            ;;
        -f|--force-rebuild)
            FORCE_REBUILD=true
            shift
            ;;
        -n|--no-backup)
            BACKUP_DB=false
            shift
            ;;
        -d|--dry-run)
            DRY_RUN=true
            shift
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Main deployment process
log_info "Starting Smart Cheques deployment..."
log_info "Environment: $ENVIRONMENT"
log_info "Dry run: $DRY_RUN"

if [[ "$DRY_RUN" == "true" ]]; then
    log_warning "DRY RUN MODE - No actual changes will be made"
fi

# Execute deployment steps
check_prerequisites
run_tests
backup_database
build_images
run_migrations
deploy_services
verify_deployment
cleanup
show_deployment_info

log_success "Smart Cheques deployment completed successfully!"

if [[ "$DRY_RUN" == "true" ]]; then
    log_info "This was a dry run. To execute the deployment, run without --dry-run flag."
fi