## Smart Cheques – Feature Implementation Plan

Status legend: [ ] TODO, [~] In Progress, [x] Done

Last updated: 2025-12-19 (completed BR-02/03, VAL-02, CON-01/02)

### Goals
- Finalize core product features: milestone escrow, oracles, disputes, governance, validator/consensus scaffolding, bridging, and full-stack integrations (backend API + frontend UI + DB projections).
- Harden security via timelock-controlled upgrades and role configuration.
- Provide end-to-end tests and runnable local/dev environments.

### Scope
This plan covers changes across:
- Contracts: `SmartChequeEscrow`, `SmartChequeFactory`, `ObligationRegistry`, `DisputeManager`, `GovernanceToken`, `SmartChequeGovernor`, `SmartChequeTimelockController`, `ValidatorManager`, `ConsensusManager`, `bridge/ERC20Bridge`, `bridge/NativeBridge`.
- Backend: Express API (`src/server.ts`), services (`EventListener`, `OracleService`, `RelayerService`), DB (`src/db` + `schema.sql`).
- Frontend: React app pages (`Dashboard`, `CreateCheque`, `ChequeDetails`, `DisputeManager`) and wallet connector.
- Tooling/infra: Hardhat deployment wiring, envs, Docker.

### Acceptance Criteria (high-level)
- Users can create cheques, view them, and complete milestones (on-chain proof or off-chain signed flow).
- Oracle verification path is callable and affects state (scores and verification status).
- Dispute flow supports escalation and resolution, including partial release path.
- Governance and timelock own admin roles for upgradable contracts; critical functions gated.
- Bridges can accept deposits and finalize withdrawals end-to-end in a dev scenario.
- Backend endpoints are complete and return persisted data; frontend uses correct API paths.
- Test suite covers critical paths (escrow, disputes, oracle, governance roles, bridges) and passes locally.

---

### Work Breakdown and Checklist

#### 0) Planning and prerequisites
- [x] Inventory contracts and services; align README and docs
- [ ] Confirm environment matrices (local, docker, testnet) and finalize `.env` templates for root/backend/frontend

#### 1) Contracts – Escrow and Oracles
- [x] SC-01: Implement real `_verifyMilestone` in `SmartChequeEscrow` integrating `ObligationRegistry` (e.g., call `verifyObligation(obligationId)` or proof verification hook)
- [x] SC-02: Ensure access control for `resolveDispute` is restricted to `DisputeManager` (add role/check)
- [x] SC-03: Add event(s) for verification results and milestone proof reference
- [x] SC-04: Unit tests for verification success/failure and edge cases (completed 2025-12-19)

#### 2) Contracts – ObligationRegistry and Oracle integration
- [x] OR-01: Align on function naming with backend service
  - Added `updateReliabilityScore(address,uint8)` as alias to `updateOracleScore`
- [x] OR-02: Add view/query helpers to fetch scores and constraint params
- [x] OR-03: Extend tests for registration gate (minimum score) and verify toggling; nonReentrant path already present (completed 2025-12-19)

#### 3) Contracts – DisputeManager
- [x] DM-01: Implement Partial Release resolution branch execution (split payments)
- [x] DM-02: Implement auto panel selection logic with real arbitrator registry (or curated list) instead of placeholder
- [x] DM-03: Enforce panel vote counting with deterministic averaging/rounding; add events/asserts
- [x] DM-04: Wire strict role checks for escalations and voting; extend tests (vote quorum, tie-breaks, auto-resolve)

#### 4) Contracts – Governance & Timelock
- [x] GOV-01: Authorize timelock/dao as admin for upgradable contracts (`DEFAULT_ADMIN_ROLE` where applicable); remove EOAs
- [x] GOV-02: Wire `SmartChequeGovernor` + `SmartChequeTimelockController` with `GovernanceToken`
- [x] GOV-03: Add deployment script to configure roles, proposers, executors, delays, and handover
- [x] GOV-04: Governance tests: schedule/execute upgrade, pause/unpause, param changes; emergency category path (completed 2025-12-19)

#### 5) Contracts – Validator & Consensus scaffolding
- [x] VAL-01: Finalize `ValidatorManager` reward transfers (check mint/transfer policy); define treasury address instead of contract self for slashed tokens
- [x] VAL-02: Add ORACLE/SEQUENCER role assignment flows and tests; integrate with `ConsensusManager`
- [x] CON-01: Verify challenge window logic and `FraudProof` lifecycle, plus `recordBlockProduction` hook
- [x] CON-02: Minimal tests to exercise propose/validate/finalize/challenge/checkpoint

#### 6) Contracts – Bridges
- [x] BR-01: Replace simplified signature checks with proper ECDSA verification; define validator set source and quorum
- [x] BR-02: Ensure RELAYER_ROLE and VALIDATOR_ROLE assignment and revoke flows; tests for challenge window edge cases
- [x] BR-03: Happy-path e2e for ERC-20 and Native deposit → withdrawal finalization with Merkle proof

#### 7) Backend – API completeness
- [x] BE-01: Implement `/api/cheques?address=` using DB projection (join with on-chain when missing)
- [x] BE-02: Add missing endpoint `POST /api/cheques/:chequeId/metadata` used by frontend; persist milestones metadata to DB
- [x] BE-03: Implement `/api/disputes?address=` from DB; support pagination and filters
- [x] BE-04: Error model standardization; add request validation for all endpoints
- [x] BE-05: Add health and version endpoints (`/healthz`, `/readyz`)
  - Added `/version`
  - Added relayer admin endpoints: `/api/admin/relayer/{status,start,stop,trigger}`

#### 8) Backend – Services
- [x] SV-01: Wire `EventListener.initialize()` in server bootstrap or a worker; set `START_BLOCK` and contract addresses from env
- [x] SV-02: Complete `OracleService` integration path to `ObligationRegistry` (adjust function name per OR-01); schedule verification job
- [x] SV-03: Expose `RelayerService` controls (status/trigger) via admin endpoints; background intervals aligned with config
- [x] SV-04: Add logging/metrics (basic winston + counters), and resilience for node restarts (re-listen past range)

#### 9) Frontend – API and UX fixes
- [x] FE-01: Align API base path with backend `/api` prefix
  - `Dashboard.tsx`: currently calls `${VITE_API_URL}/cheques` → change to `${VITE_API_URL}/api/cheques`
  - `DisputeManager.tsx`: `${VITE_API_URL}/disputes` → `${VITE_API_URL}/api/disputes`
- [x] FE-02: Display obligation verification status per milestone (from backend/contract); surface pending/verified
- [x] FE-03: Dispute flow UX: open, escalate (single or panel), and resolve (arbitrator role-gated)
- [ ] FE-04: Error toasts and loading skeletons standardized; chain/network indicators refined

#### 10) Database & Migrations
- [ ] DB-01: Verify `schema.sql` meets new data points (e.g., store verification flags, resolution amounts); add migrations if needed
- [x] DB-02: Indexes for common queries (address filters, created_at desc); verify performance

#### 11) Deployment & Envs
- [x] DEP-01: Extend `scripts/deploy.ts` to deploy GovernanceToken, Timelock, Governor; configure roles across contracts
- [x] DEP-02: Provide `.env.example` for root, backend, frontend; document mapping in README
- [x] DEP-03: Docker compose env parity (ports, API URLs, RPCs); verify local up

#### 12) Testing & CI
- [x] TEST-01: Comprehensive `DisputeManager` tests (single arbitrator, panel voting, edge cases)
- [x] TEST-02: API tests (supertest/vitest) for key endpoints and validations
- [x] TEST-03: E2E happy path: create cheque → lock funds → complete milestone → dispute/resolve → verify via oracle
- [x] TEST-04: Slither/static analysis run and address findings; gas reporter baseline

#### 13) Ethers v6 Migration
- [x] ETH-01: Update RelayerService.ts to use ethers v6 API
- [x] ETH-02: Update EventListener.ts for v6 compatibility (event handling, chainId conversion)
- [x] ETH-03: Fix server.ts type annotations and chainId conversions
- [x] ETH-04: Verify frontend components compatibility (completed in previous sessions)
- [x] ETH-05: Successful backend and frontend builds

#### 14) Test Suite Migration (ethers v6)
- [x] TEST-ETH-01: `test/helpers/AuthorizationTestHelper.ts` - Updated imports and ethers.utils calls
- [x] TEST-ETH-02: `test/BridgesE2E.test.ts` - Migrated ethers v5 syntax to v6
- [x] TEST-ETH-03: `test/SimpleTest.test.ts` - Updated parseEther and deployed() calls
- [x] TEST-ETH-04: `test/ConsensusMinimal.test.ts` - Fixed deployed() and constants usage
- [~] TEST-ETH-05: `test/ObligationRegistry.test.ts` - Partially updated (complex type issues remain)
- [ ] TEST-ETH-06: `test/SmartChequeVerification.test.ts` - Migrate ethers v5 syntax
- [ ] TEST-ETH-07: `test/ReentrancyProtection.test.ts` - Update ethers.utils calls
- [ ] TEST-ETH-08: `test/MultiArbitratorDispute.test.ts` - Fix ethers v5 compatibility
- [ ] TEST-ETH-09: `test/integration/EndToEndEscrow.test.ts` - Comprehensive migration
- [ ] TEST-ETH-10: `test/BridgeRoles.test.ts` - Update all ethers v5 references
- [ ] TEST-ETH-11: Complete migration validation and test suite execution

#### 15) Security & Governance (from Docs/F1 checklist)
- [ ] SEC-01: Timelock-controlled upgrades enforced (all upgradeable contracts)
- [ ] SEC-02: Multi-sig requirements for timelock proposer/executor where appropriate
- [ ] SEC-03: Formal verification candidates identified (Escrow core, DisputeManager critical paths)

---

### Task Dependencies (simplified)
- FE-01 depends on BE-01/BE-03 paths and final API prefix
- OR-01 precedes SV-02
- GOV-01..03 precede SEC-01
- BR-01 precedes BR-03 and SV-03

### Tracking and Updates
- We will update this file as we execute tasks. The “Next task” is always the top-most unchecked item in the earliest section not blocked by dependencies.

### Next Task Priority (Post Ethers v6 Migration)

**Immediate Priority:**
- **TEST-ETH-05 to TEST-ETH-11**: Complete remaining test file migrations to ethers v6
- **FE-04**: Error toasts and loading skeletons standardized; chain/network indicators refined
- **SEC-01**: Timelock-controlled upgrades enforced (all upgradeable contracts)

**Medium Priority:**
- **SEC-02**: Multi-sig requirements for timelock proposer/executor where appropriate
- **SEC-03**: Formal verification candidates identified (Escrow core, DisputeManager critical paths)
- **DB-01**: Verify `schema.sql` meets new data points (e.g., store verification flags, resolution amounts); add migrations if needed

**Completed Recently:**
- ✅ **ETH-01 to ETH-05**: Complete ethers v6 migration with successful builds
- ✅ **TEST-ETH-01 to TEST-ETH-04**: Initial test file migrations to ethers v6
- ✅ **TEST-04**: Slither/static analysis run and address findings; gas reporter baseline
- ✅ **DB-02**: Indexes for common queries optimization