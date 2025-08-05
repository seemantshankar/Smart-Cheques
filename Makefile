.PHONY: install build test clean docker-build docker-up docker-down migrate-up migrate-down lint format

# Development setup
install:
	npm install --prefix frontend
	npm install --prefix src
	npm install --prefix .

# Build all applications
build:
	npm run build --prefix frontend
	npm run build --prefix src

# Run tests
test:
	npm test --prefix frontend
	npm test --prefix src
	npx hardhat test

# Clean build artifacts
clean:
	rm -rf frontend/build
	rm -rf src/dist
	rm -rf artifacts
	rm -rf cache

# Docker commands
docker-build:
	docker-compose build

docker-up:
	docker-compose up -d

docker-down:
	docker-compose down

# Database migrations
migrate-up:
	cd src && npm run migrate:up

migrate-down:
	cd src && npm run migrate:down

# Code quality
lint:
	npm run lint --prefix frontend
	npm run lint --prefix src
	npx solhint 'contracts/**/*.sol'

format:
	npm run format --prefix frontend
	npm run format --prefix src
	npx prettier --write 'contracts/**/*.sol'

# Smart contract deployment
deploy-local:
	npx hardhat run scripts/deploy.ts --network localhost

deploy-testnet:
	npx hardhat run scripts/deploy.ts --network testnet

deploy-mainnet:
	npx hardhat run scripts/deploy.ts --network mainnet

# Development servers
dev-frontend:
	npm run dev --prefix frontend

dev-backend:
	npm run dev --prefix src

dev-blockchain:
	npx hardhat node

# Start all development servers
dev: docker-up
	make dev-blockchain & make dev-backend & make dev-frontend

# Default target
all: install build