# Smart Cheques Platform

A decentralized platform for creating and managing smart cheques with milestone-based payments, oracle-backed obligation verification, dispute resolution, and optional L1↔L2 bridging.

## Features

- **Milestone escrow**: Create smart cheques with multiple milestones and release funds per milestone
- **Token escrow**: ERC-20 lock and release with reentrancy protection
- **Oracles**: Obligation verification with reliability scoring and minimum score gating
- **Disputes**: Single arbitrator and multi-arbitrator panel flow with quorum/threshold voting
- **Bridging (optional)**: ERC-20 and native token bridges with Merkle-root based withdrawals and validator quorum
- **Modern frontend**: React + Chakra UI, MetaMask (web3-react v8)
- **Backend API**: Express + Ethers v5, event listener scaffolding, DB schema for persistence

## Architecture Overview

- `contracts/`
  - `SmartChequeFactory.sol`: UUPS-upgradeable factory deploying `SmartChequeEscrow` via Beacon proxies; tracks `chequeId → address` and emits `ChequeCreated`.
  - `SmartChequeEscrow.sol`: Milestone-based escrow with ERC-20 lock, milestone completion, EIP-712 off-chain signature flow with replay protection.
  - `ObligationRegistry.sol`: Registers obligations and verifies via external oracle call; manages oracle reliability scores and a minimum score gate.
  - `DisputeManager.sol`: Dispute lifecycle with legacy single arbitrator and multi-arbitrator panel (threshold/quorum) workflows.
  - `Governance.sol` (`SmartChequeGovernor`): On-chain governance (OpenZeppelin Governor) with counting, quorum fraction, votes (ERC20Votes), timelock control, and helper proposal methods.
  - `TimelockController.sol` (`SmartChequeTimelockController`): Timelock with proposal categories (standard/emergency/critical) and adjustable delays; supports emergency mode.
  - `GovernanceToken.sol`: ERC20Votes + Permit token used for governance voting and staking; includes basic staking, rewards, and validator eligibility hooks.
  - `ValidatorManager.sol`: Validator lifecycle and delegation management, slashing/jailing, block reward distribution, and configurable parameters under governance.
  - `ConsensusManager.sol`: PoS-style consensus orchestration mock with block proposal/validation, challenge window, simplified fraud proofs, and periodic checkpoints; integrates with `ValidatorManager`.
  - `bridge/ERC20Bridge.sol`: Token bridge, deposits, Merkle-based withdrawals, validator quorum, challenge period.
  - `bridge/NativeBridge.sol`: Native token bridge with similar semantics and emergency withdrawal.
- `src/` (backend)
  - `server.ts`: REST API endpoints for cheques and disputes, connects to deployed contracts.
  - `services/EventListener.ts`: Watches on-chain events, backfills history, persists to DB.
  - `services/OracleService.ts`: Aggregates oracle results and updates reliability scores on-chain.
  - `services/RelayerService.ts`: Builds Merkle roots from withdrawals and updates bridge contracts (simplified signatures in-code).
  - `db/` + `schema.sql`: Postgres schema and DB adapter.
- `frontend/` (React)
  - Vite + Chakra UI app; wallet connect via `@web3-react/metamask` v8; pages for Dashboard, Create Cheque, Cheque Details, Disputes.

## Project Structure

```
├── contracts/                  # Solidity contracts
│   ├── bridge/
│   │   ├── ERC20Bridge.sol
│   │   └── NativeBridge.sol
│   ├── ConsensusManager.sol
│   ├── DisputeManager.sol
│   ├── Governance.sol
│   ├── GovernanceToken.sol
│   ├── ObligationRegistry.sol
│   ├── SmartChequeEscrow.sol
│   ├── SmartChequeFactory.sol
│   ├── TimelockController.sol
│   └── ValidatorManager.sol
├── Docs/                       # Security, implementation plans
├── frontend/                   # React frontend (Vite)
│   └── src/
├── src/                        # Backend (Express + Ethers)
│   ├── db/
│   ├── services/
│   ├── server.ts
│   └── schema.sql
├── scripts/                    # Hardhat deployment scripts
├── test/                       # Hardhat tests
└── docker-compose.yml          # Optional local stack (frontend/backend/db/redis)
```

## Prerequisites

- Node.js >= 18
- pnpm or npm
- Hardhat (installed via devDependencies)
- MetaMask or any EIP-1193 wallet
- Optional: Docker + Docker Compose (for full local stack with Postgres)

## Installation

1) Clone the repository
```bash
git clone <repository-url>
cd Smart-Cheques
```

2) Install dependencies
```bash
# Root (contracts)
pnpm install  # or npm install

# Frontend
cd frontend
pnpm install  # or npm install

# Backend
cd ../src
pnpm install  # or npm install
```

## Environment Variables

Create `.env` files for root, backend, and frontend. Examples below show typical localhost values.

### Root `.env` (used by Hardhat scripts and backend services)
```
RPC_URL=http://127.0.0.1:8545
PRIVATE_KEY=0xYOUR_PRIVATE_KEY

# Deployed contract addresses
FACTORY_ADDRESS=0x...
OBLIGATION_REGISTRY_ADDRESS=0x...
DISPUTE_MANAGER_ADDRESS=0x...

# Event listener
START_BLOCK=0

# Oracle config (if using OracleService)
BAND_PROTOCOL_ADDRESS=0x...
BAND_PROTOCOL_ENDPOINT=https://band.example
BAND_PROTOCOL_API_KEY=
CHAINLINK_NODE_ADDRESS=0x...
CHAINLINK_API_KEY=
```

### Backend `src/.env`
```
# Chain + signer
RPC_URL=http://127.0.0.1:8545
PRIVATE_KEY=0xYOUR_PRIVATE_KEY

# Contracts
FACTORY_ADDRESS=0x...
OBLIGATION_REGISTRY_ADDRESS=0x...
DISPUTE_MANAGER_ADDRESS=0x...

# API server
PORT=3000

# Database (Postgres)
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=smart_cheques
DB_USER=postgres
DB_PASSWORD=postgres

# Event listener
START_BLOCK=0

# Oracles (optional)
BAND_PROTOCOL_ADDRESS=0x...
BAND_PROTOCOL_ENDPOINT=https://band.example
BAND_PROTOCOL_API_KEY=
CHAINLINK_NODE_ADDRESS=0x...
CHAINLINK_API_KEY=
```

### Frontend `frontend/.env`
```
VITE_CHAIN_ID=31337
VITE_RPC_URL=http://127.0.0.1:8545
VITE_FACTORY_ADDRESS=0x...
VITE_DISPUTE_MANAGER_ADDRESS=0x...
# Base URL for backend API (backend prefixes routes with /api)
VITE_API_URL=http://localhost:3000
```

## Local Development (without Docker)

1) Start a local chain and deploy contracts
```bash
# In project root
pnpm run node           # or: npx hardhat node
pnpm run compile
npx hardhat run scripts/deploy.ts --network localhost
```
Copy deployed addresses into Root `.env`, Backend `src/.env`, and Frontend `frontend/.env`.

2) Setup database (optional but recommended)
```bash
# Ensure Postgres is running locally and credentials match backend .env
psql -h 127.0.0.1 -U postgres -d smart_cheques -f src/schema.sql
```

3) Start backend
```bash
cd src
pnpm run build && pnpm run start    # or: pnpm run dev for ts-node-dev
# Backend defaults to http://localhost:3000
```

4) Start frontend
```bash
cd frontend
pnpm run dev
# Frontend runs on http://localhost:5173
```

## Docker (optional)

The `docker-compose.yml` spins up frontend, backend, Postgres, and Redis.

```bash
docker compose up --build
```

Environment defaults map backend to `http://localhost:4000` and frontend to `http://localhost:3000`. Adjust `VITE_API_URL` accordingly if you use Docker (e.g., `http://localhost:4000`).

## API Endpoints (backend)

Base URL: `http://localhost:<PORT>/api`

- `GET /cheques?address=<0x...>` → List cheques for address
- `POST /cheques` → Create a cheque
  - body: `{ buyer, seller, totalAmount, milestones, obligations }`
- `GET /cheques/:chequeId` → Get cheque details (reads on-chain escrow)
- `POST /cheques/:chequeId/milestones/:milestoneId/complete` → Complete milestone (submits tx)

- `GET /disputes?address=<0x...>` → List disputes for address
- `POST /disputes` → Open dispute
  - body: `{ chequeAddress, milestoneId, reason, evidence }`
- `GET /disputes/:disputeId` → Get dispute details

Note: Some list endpoints currently return empty arrays pending full DB integration. The schema and `EventListener` are provided to enable persistence.

## Frontend

- Wallet connect via MetaMask (`@web3-react/metamask` v8) with typed EIP-1193 provider.
- Pages
  - Dashboard: lists cheques and aggregates stats
  - Create Cheque: constructs milestones and calls factory
  - Cheque Details: milestone progress and completion
  - Disputes: view and resolve (arbitrator)

## Backend Services

- `EventListener`: backfills and listens to events from Factory, ObligationRegistry, DisputeManager; persists via `src/db`.
- `OracleService`: queries Band/Chainlink (placeholders), aggregates by reliability scores, and updates scores on-chain.
- `RelayerService`: monitors bridge events, builds Merkle roots, and updates root on L1 and Native bridges (signature logic simplified for demo).

These services are provided as classes; wire them into a worker or your API as needed.

## Contracts Summary

- `SmartChequeFactory` (UUPS): deploys `SmartChequeEscrow` via Beacon, tracks IDs, pause/unpause, and implementation upgrade via admin role.
- `SmartChequeEscrow`: ERC-20 lock with milestones, on-chain proof hook (`_verifyMilestone` placeholder), and EIP-712 off-chain authorization (`completeMilestoneWithSignature`) with replay protection.
- `ObligationRegistry`: obligation registration, verification via external call (CEI pattern), and oracle reliability scoring and minimum score updates.
- `DisputeManager`: dispute open/escalate, arbitrator panels, quorum-based resolution, and execution against escrow.
- Bridges: `ERC20Bridge` and `NativeBridge` for deposits/withdrawals, Merkle proofs, validator quorum, and challenge periods.

## Testing

Run the smart contract tests:
```bash
npx hardhat test
```
Included tests cover: EIP-712 off-chain milestone completion happy path and failure scenarios, and reentrancy protection surfaces across core contracts.

## Security Considerations

- Upgradeability: UUPS proxies with role-gated `_authorizeUpgrade`
- Access control: OpenZeppelin `AccessControl`
- Reentrancy: `nonReentrant` on sensitive functions
- CEI: Checks-Effects-Interactions pattern before external calls
- Pausability: `PausableUpgradeable` on critical contracts
- Bridging: challenge periods and validator quorum for root updates/withdrawals

## Known Limitations / TODO

- `_verifyMilestone` in `SmartChequeEscrow` is a stub; integrate real proof verification.
- Backend list endpoints return empty arrays until DB-backed projections are enabled end-to-end.
- Oracle/Relayer signature verification is simplified; implement robust sig checks and validator set mgmt.
- `DisputeManager` partial release flow and auto panel selection are placeholders.
- Ensure frontend/backend `VITE_API_URL` base path aligns with `/api` prefix.

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.