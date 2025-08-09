# Smart Cheques Platform - Deployment Guide

This guide provides comprehensive instructions for deploying the Smart Cheques platform across different environments.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Environment Setup](#environment-setup)
- [Local Development](#local-development)
- [Staging Deployment](#staging-deployment)
- [Production Deployment](#production-deployment)
- [Docker Deployment](#docker-deployment)
- [Database Management](#database-management)
- [Monitoring & Logging](#monitoring--logging)
- [Troubleshooting](#troubleshooting)
- [Security Considerations](#security-considerations)

## Prerequisites

### System Requirements

- **Node.js**: v18.0.0 or higher
- **npm**: v8.0.0 or higher
- **Docker**: v20.0.0 or higher
- **Docker Compose**: v2.0.0 or higher
- **PostgreSQL**: v14.0 or higher
- **Redis**: v6.0 or higher
- **Git**: Latest version

### Required Accounts & Services

- **Blockchain RPC Provider**: Infura, Alchemy, or QuickNode
- **IPFS Provider**: Infura IPFS or Pinata
- **Monitoring**: Sentry, DataDog, or New Relic
- **Domain & SSL**: Cloudflare or AWS Certificate Manager
- **Cloud Provider**: AWS, GCP, or Azure (for production)

## Environment Setup

### 1. Clone Repository

```bash
git clone https://github.com/your-org/smart-cheques.git
cd smart-cheques
```

### 2. Environment Files

Copy the appropriate environment template:

```bash
# For local development
cp .env.example .env.local

# For staging
cp .env.staging .env.staging

# For production
cp .env.production .env.production
```

### 3. Configure Environment Variables

Edit the environment files with your specific values:

#### Critical Variables to Update:

```bash
# Blockchain
RPC_URL=your_rpc_endpoint
CHAIN_ID=your_chain_id

# Database
DB_PASSWORD=secure_password
DB_USER=your_db_user

# Security
JWT_SECRET=your_jwt_secret
CSRF_SECRET=your_csrf_secret

# External Services
ETHERSCAN_API_KEY=your_etherscan_key
IPFS_PROJECT_ID=your_ipfs_project_id
SENTRY_DSN=your_sentry_dsn
```

## Local Development

### 1. Install Dependencies

```bash
# Install root dependencies
npm install

# Install backend dependencies
cd src && npm install && cd ..

# Install frontend dependencies
cd frontend && npm install && cd ..

# Install smart contract dependencies
npm run install:contracts
```

### 2. Start Local Services

```bash
# Start PostgreSQL and Redis
docker-compose up -d postgres redis

# Run database migrations
npm run migrate:up

# Seed development data (optional)
npm run seed:dev
```

### 3. Deploy Smart Contracts (Local)

```bash
# Start local Hardhat node
npm run node:local

# Deploy contracts to local network
npm run deploy:local

# Verify deployment
npm run verify:local
```

### 4. Start Development Servers

```bash
# Start all services
npm run dev

# Or start individually
npm run dev:backend    # Backend API (port 3001)
npm run dev:frontend   # Frontend (port 3000)
npm run dev:contracts  # Contract compilation watcher
```

### 5. Access Development Environment

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001
- **API Documentation**: http://localhost:3001/docs
- **Database Admin**: http://localhost:8080 (pgAdmin)

## Staging Deployment

### 1. Prepare Staging Environment

```bash
# Set environment
export NODE_ENV=staging

# Load staging configuration
source .env.staging
```

### 2. Deploy to Testnet

```bash
# Deploy smart contracts to testnet
npm run deploy:staging

# Verify contracts on Etherscan
npm run verify:staging

# Update contract addresses in environment
# Edit .env.staging with deployed addresses
```

### 3. Deploy Application

```bash
# Build and deploy using Docker
./deploy.sh staging

# Or manual deployment
npm run build:staging
npm run start:staging
```

### 4. Run Tests

```bash
# Run full test suite
npm run test:staging

# Run integration tests
npm run test:integration

# Run end-to-end tests
npm run test:e2e
```

## Production Deployment

### 1. Pre-deployment Checklist

- [ ] All tests passing
- [ ] Security audit completed
- [ ] Smart contracts verified
- [ ] Database backup created
- [ ] SSL certificates configured
- [ ] Monitoring alerts set up
- [ ] Rollback plan prepared

### 2. Deploy Smart Contracts

```bash
# Deploy to mainnet (use with caution)
npm run deploy:mainnet

# Verify contracts
npm run verify:mainnet

# Initialize contracts
npm run initialize:mainnet
```

### 3. Production Deployment

```bash
# Automated deployment
./deploy.sh production

# Manual deployment steps:
# 1. Build production images
docker-compose -f docker-compose.prod.yml build

# 2. Run database migrations
npm run migrate:prod

# 3. Deploy services
docker-compose -f docker-compose.prod.yml up -d

# 4. Verify deployment
npm run health:check
```

### 4. Post-deployment Verification

```bash
# Check service health
curl https://api.smartcheques.com/health

# Verify database connectivity
npm run db:check

# Test critical endpoints
npm run test:smoke
```

## Docker Deployment

### 1. Build Images

```bash
# Build all images
docker-compose build

# Build specific service
docker-compose build backend
docker-compose build frontend
```

### 2. Environment-specific Deployment

```bash
# Development
docker-compose up -d

# Staging
docker-compose -f docker-compose.staging.yml up -d

# Production
docker-compose -f docker-compose.prod.yml up -d
```

### 3. Service Management

```bash
# View logs
docker-compose logs -f backend
docker-compose logs -f frontend

# Restart services
docker-compose restart backend

# Scale services
docker-compose up -d --scale backend=3

# Update services
docker-compose pull
docker-compose up -d
```

## Database Management

### 1. Migrations

```bash
# Run migrations
npm run migrate:up

# Rollback migrations
npm run migrate:down

# Check migration status
npm run migrate:status

# Create new migration
npm run migrate:create add_new_feature
```

### 2. Backups

```bash
# Create backup
npm run db:backup

# Restore from backup
npm run db:restore backup_file.sql

# Automated backup (production)
# Configured in docker-compose.prod.yml
```

### 3. Seeding

```bash
# Seed development data
npm run seed:dev

# Seed test data
npm run seed:test

# Reset database
npm run db:reset
```

## Monitoring & Logging

### 1. Application Monitoring

- **Grafana Dashboard**: http://your-domain:3000
- **Prometheus Metrics**: http://your-domain:9090
- **Sentry Error Tracking**: https://sentry.io

### 2. Log Management

```bash
# View application logs
docker-compose logs -f backend
docker-compose logs -f frontend

# View system logs
journalctl -u docker

# Log aggregation with Loki
# Configured in docker-compose.prod.yml
```

### 3. Health Checks

```bash
# Application health
curl http://localhost:3001/health

# Database health
curl http://localhost:3001/health/db

# Blockchain connectivity
curl http://localhost:3001/health/blockchain
```

## Troubleshooting

### Common Issues

#### 1. Database Connection Issues

```bash
# Check database status
docker-compose ps postgres

# View database logs
docker-compose logs postgres

# Test connection
psql -h localhost -U smartcheques -d smart_cheques
```

#### 2. Smart Contract Deployment Failures

```bash
# Check network connectivity
npm run network:check

# Verify gas settings
npm run gas:estimate

# Check account balance
npm run balance:check
```

#### 3. Frontend Build Issues

```bash
# Clear cache
npm run clean

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Check environment variables
npm run env:check
```

#### 4. Performance Issues

```bash
# Check resource usage
docker stats

# Analyze slow queries
npm run db:analyze

# Monitor API performance
npm run perf:monitor
```

### Debug Mode

```bash
# Enable debug logging
export DEBUG=smart-cheques:*

# Run with verbose output
npm run dev -- --verbose

# Enable SQL query logging
export DB_LOGGING=true
```

## Security Considerations

### 1. Environment Security

- Never commit `.env` files to version control
- Use strong, unique passwords for all services
- Rotate secrets regularly
- Enable 2FA for all service accounts

### 2. Network Security

- Use HTTPS/TLS for all communications
- Configure proper CORS settings
- Implement rate limiting
- Use VPN for production access

### 3. Smart Contract Security

- Audit contracts before mainnet deployment
- Use multi-signature wallets for admin functions
- Implement timelock for critical operations
- Monitor for unusual activity

### 4. Infrastructure Security

- Keep all dependencies updated
- Use container scanning
- Implement proper logging and monitoring
- Regular security assessments

## Maintenance

### Regular Tasks

```bash
# Update dependencies
npm run update:deps

# Security audit
npm audit

# Clean up old images
docker system prune

# Backup database
npm run db:backup
```

### Monitoring Checklist

- [ ] Application uptime
- [ ] Database performance
- [ ] Blockchain connectivity
- [ ] Error rates
- [ ] Response times
- [ ] Resource usage
- [ ] Security alerts

## Support

For deployment issues:

- **Documentation**: [docs.smartcheques.com](https://docs.smartcheques.com)
- **Issues**: [GitHub Issues](https://github.com/your-org/smart-cheques/issues)
- **Discord**: [Smart Cheques Community](https://discord.gg/smartcheques)
- **Email**: support@smartcheques.com

---

**Note**: Always test deployments in staging before production. Keep this guide updated with any changes to the deployment process.