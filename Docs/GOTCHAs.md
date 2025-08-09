🛡️ Blockchain Project Pitfalls & Best Practices (2025 Edition)

A living checklist and style/quality guide for blockchain teams across smart contracts, frontends, and integrations. Explicitly documents learnings, gotchas, and preventive tooling & code habits.

📁 Table of Contents

- Smart Contracts
- Linting & Tooling
- Security & Static Analysis
- Collaboration & Workflow
- Practical Checklists
- Frontend / TypeScript / Backend
- Data, Indexing, and Off-chain Services
- CI/CD Recommendations
- Testing Strategy
- Monitoring, Observability, and Ops
- Governance, Upgrades, and Key Management
- Quick Commands Reference
- Policy on Rule Suppression

🔐 Smart Contracts

⚠️ Diff Markers Break Parsers
- Prevention:
  ```sh
  git grep -n '<<<<<<<\|=======\|>>>>>>>' -- ':!package-lock.json'
  ```
- Also grep for leading diff-style + / - in Solidity:
  ```sh
  git grep -n '^\s*[+-]\s' -- 'contracts/**/*.sol'
  ```

🚫 Empty Blocks Trigger Solhint Warnings
- Scoped suppression or harmless no-op, with a “why” comment.

🗑️ Unused Variables and Code Elements
- Prefer single-line initialization; inline suppression for interface params; use consistent throwaway names like __unused.
- **Unused Imports**: Remove unused imports like `AggregatorV3Interface` that are imported but never used in the contract.
- **Unused Modifiers**: Remove modifiers like `onlySeller` that are defined but never applied to any functions.
- **Unused Errors**: Clean up custom error definitions that are no longer referenced after code refactoring (e.g., `TransferFailed` after switching to `Address.sendValue`).
- **Orphaned Events**: Add functions to utilize existing events or remove unused event definitions to maintain clean interfaces.

🔁 Duplicate Logic After Merge
- Consolidate and comment; add unit tests to prevent regressions.

🌐 Inconsistent Pragma & Compiler Versions
- Enforce via Hardhat config and pragma checker.

Reentrancy and State Ordering
- Apply Checks-Effects-Interactions; use ReentrancyGuard or pull payments; avoid external calls in loops.
- **Raw Call Safety**: Replace raw `call` operations with OpenZeppelin's `Address.sendValue()` for native token transfers to improve reentrancy protection.
- **Gas Limit Constants**: Remove unused gas limit constants when switching from raw calls to library functions.
- **Library Warnings**: OpenZeppelin's Address utility functions may show reentrancy warnings - these are expected and safe as the library includes proper protections.

Access Control and Roles
- Standardize roles; test negative paths; log role changes via events; off-board keys promptly.
- **Function Call Context**: Avoid `this.functionName()` calls within contracts as they change caller context and break access control
- Use internal calls or duplicate logic for alias functions to maintain proper access control

Upgradeable Contracts
- Use OZ Upgrades; verify storage layout with storage layout diffing (hardhat-upgrades or forge storage-check); avoid constructors; versioned initializers; document gaps.
- **CRITICAL**: Always use `upgrades.deployProxy()` for upgradeable contracts, never direct deployment with `ethers.deployContract()`
- Test deployment methods in CI to catch initialization failures early

Event Strategy
- Emit for state mutations; index frequently queried fields; avoid over-indexing to save gas; formalize event schemas for indexers.

Arithmetic, Precision, and Rounding
- Use libraries for fixed-point math; specify rounding direction; test edge cases; avoid division by zero.
- **Data Type Precision**: Verify exact byte lengths for Solidity types (`bytes4` = 4 bytes = 8 hex chars, `bytes32` = 32 bytes = 64 hex chars)
- **Parameter Format**: Understand how Solidity encodes/returns data; bytes parameters return as hex strings in tests

Error Handling
- Prefer custom errors over strings; encode context; assert revert reasons in tests.
- **Test Alignment**: Use `revertedWithCustomError(contract, "ErrorName")` for custom errors, not `revertedWith("string")`
- Maintain exact error name consistency between contract definitions and test expectations
- Verify all expected events are actually emitted by contract functions

Token Safety
- Use SafeERC20; beware fee-on-transfer tokens; use balance deltas rather than assumed amounts.

Signature Domain Separation
- Use EIP-712; include chainId, verifying contract, nonce, deadlines; test different wallets and hardware signers.

Time, Oracles, and Liveness
- Validate freshness; fallback feeds; staleness windows; TWAP; handle block.timestamp manipulation with tolerances.

DoS via Unbounded Loops
- Avoid iterating on user-controlled arrays/maps; implement pagination; impose caps.

Deterministic Deployments and Address Confusion
- Use CREATE2 for predictable addresses when needed; verify chainId before deployment; never reuse testnet addresses on mainnet.

Chain-Specific Quirks
- L2/L3 finality windows; preconf contract addresses; gas token differences; EIP-1559 vs legacy; non-standard RPC behaviors. Document per target chain.

Pausing and Circuit Breakers
- Include Pausable/guardian roles; rehearse incident playbooks; cold-path for resume.

Multi-sig and Governance Timelocks
- Protect admin/upgrade roles with multisig; timelock critical changes; document guardians and escalation paths.

Gas Optimization Hygiene
- Avoid storage writes within tight loops; pack storage; prefer calldata for external args; batch operations; track gas snapshots in CI.

Formal Interface Boundaries
- Verify against canonical interfaces; include interface tests to prevent accidental signature mismatches.

NatSpec and ABI Stability
- Maintain NatSpec for external/public; document breaking changes; version ABIs.

Foundry/Hardhat Alignment
- Align compiler and optimizer across frameworks; fail CI if drift occurs.

State Machine Invariants
- Encode invariants (Foundry invariant tests or Scribble annotations); run invariants in CI.

Linting & Tooling

✅ Inline vs Scoped Solhint Suppressions
- Prefer the narrowest scope; add a “why safe” comment.

🔁 Validate After Each Edit
```sh
npx solhint 'contracts/**/*.sol'
npx hardhat compile
```

✨ Tooling Desynchronization
- Reload buffers before multi-step edits; atomic patching; avoid editing compiled artifacts.

📦 Format and Structure
- Enforce Prettier + prettier-plugin-solidity; Foundry fmt as secondary.

Hardhat/Foundry Config Consistency
- Lock solc version and optimizer runs; generate and persist compiler metadata.

Artifact Integrity
- Commit ABIs intentionally; checksum ABIs in CI; manage ABI breaking changes via versioning.

Security & Static Analysis

🐍 Slither
```sh
slither . --filter-paths node_modules
```
- Fail on Medium/High unless triaged with a documented issue.

Fuzzing and Invariants
- Foundry fuzz/invariant tests on critical paths; include boundary and pathological cases.

Symbolic/Property Testing
- Use Mythril or property frameworks where beneficial; keep specs minimal and targeted.

Scribble Annotations
- Consider Scribble for runtime-verified specs in test environments.

Secrets and Keys
- No private keys in repo; secret scanners in CI; rotate compromised secrets; sign releases; enable 2FA.

Third-Party Dependencies
- Pin OZ and critical libs; watch advisories; maintain SBOM; verify integrity with lockfiles.

Chain Config and Safeguards
- Validate chainId, RPC endpoints, and contract address maps per environment; forbid mainnet writes from non-prod using onchain guard checks.

Permit and Meta-Transactions
- Implement EIP-2612 thoroughly; handle nonce and deadline; prevent replay across chains.

Oracles and Externalities
- Diversity of sources; sanity checks; alerting on stale, zero, or implausible values.

Collaboration & Workflow

🔀 Merge Conflict Hygiene
- Grep for conflict markers; single curated resolution; no iterative patch remnants.

📝 Atomic, Reviewable Commits
- Separate logic and formatting; short, descriptive messages; link issues/PRDs.

Code Review Checklists
- Include security, gas, UX/i18n, and observability sections; require domain expert review for critical modules.

Architecture Decision Records
- Maintain ADRs for protocol/risk decisions; attach proofs/tests.

Branch Protection
- Require CI passing, code review minimums, and signed commits for protected branches.

Practical Checklists

✔️ Pre-Commit Checklist
- [ ] grep for diff markers and diff-style prefixes
- [ ] Solhint passes; suppressions justified and scoped
- [ ] Hardhat/Foundry compile passes; solc settings aligned
- [ ] No empty blocks without comment or scoped disable
- [ ] Remove duplicate logic introduced by merges
- [ ] Unit tests pass; gas snapshot within budget
- [ ] ESLint/Prettier pass; TypeScript strict passes
- [ ] No secrets in repo; secret scanner clean
- [ ] ABI changes reviewed and versioned if breaking
- [ ] **Upgradeable contracts use `upgrades.deployProxy()` not `ethers.deployContract()`**
- [ ] **Custom error tests use `revertedWithCustomError()` not `revertedWith()`**
- [ ] **Data type lengths match Solidity requirements (bytes4 = 8 hex chars)**
- [ ] **No `this.functionName()` calls in contracts with access control**
- [ ] **Test error names exactly match contract error definitions**
- [ ] **Event expectations match actual contract emissions**

🔍 Pre-Merge / CI Contract Quality
- Parse, compile, security scans, fuzz/invariants, gas thresholds, conflict markers, format consistency. Include:
  - Storage layout diffs for upgradeables
  - Event coverage percentage for public state mutations
  - ABI diff report against previous release
  - **Automated check: No `ethers.deployContract` in test files for upgradeable contracts**
  - **Automated check: No `revertedWith()` for custom errors in test files**
  - **Automated check: All bytes4 parameters have exactly 8 hex characters**
  - **Automated check: No `this.` calls in access-controlled contract functions**
  - **Test-contract alignment verified: error names and event emissions match**

Frontend / TypeScript / Backend

📦 ESLint + TypeScript Strict Mode
- Enable strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes; ban-ts-comment except with issue reference.

Ethers/Web3 Libraries
- Prefer Ethers v6; BigInt for on-chain numbers; always use parseUnits/formatUnits; wrap provider errors.

Wallet/Account UX
- Support EIP-1193 events; multi-chain detection; account change resets state safely; graceful chain switching.

Signing and Messages
- EIP-712 typed data; clear UX; explicit nonces and expiries; localized, human-readable intent preview.

UI State vs On-chain Truth
- Reflect pending/confirmed states; reorg-aware confirmation thresholds; reconcile from events.

Error Mapping
- Map custom errors to user messages; capture revert data; analytics-safe error aggregation.

Performance and Data Fetching
- Cache with react-query/SWR; debounce/poll rate controls; memoize derived values.

Security Hygiene
- CSP with strict defaults; escape HTML; avoid injecting untrusted data; SRI for third-party scripts.

Internationalization and Accessibility
- Keyboard navigation; ARIA roles; announce transaction states via SR-friendly toasts.

Offline/Caching and Reorg Safety
- Avoid caching RPC state in service workers; version caches; re-validate on focus/reconnect.

Backend and APIs
- Validate inputs with Zod/Yup/Typebox; canonicalize addresses; checksum lowercasing pitfalls.

Rate Limits and Abuse
- IP/key-based rate limiting; WAF; bot detection; circuit breakers.

Webhook Verification
- Signed payloads; timestamp and nonce; strict clock skew windows; replay protection.

Database and On-chain Consistency
- Idempotent upserts; track confirmations; reorg replay windows; reproducible ETL.

Idempotency Keys
- Enforce for all write endpoints; log correlation IDs.

Secure Key Management
- KMS/HSM for server signing; least-privileged IAM; periodic key rotations; maintain key inventory.

Observability
- Structured logs; trace IDs; metrics (latency, error rate, indexing lag); alerts on significant deviations.

RPC Strategy
- Multi-provider with health checks; quorum reads for critical queries; exponential backoff; budget RPC usage.

Data, Indexing, and Off-chain Services

Event Indexers
- Index with minimum confirmations; maintain a high-water mark and backfill windows; idempotent processing.

Reorg Handling
- Detect reorgs via ancestor hashes; undo or recompute last N blocks; maintain compensating transactions or snapshot deltas.

Subgraph and ETL Testing
- Unit test mappings; integration tests against forks; assert schema invariants.

Data Retention and Privacy
- Comply with policy/GDPR where applicable; retain minimal PII; encrypt at rest and in transit.

CI/CD Recommendations

✨ GitHub Actions Suggested Workflow
- Add:
  - Foundry build/test with gas snapshots
  - Storage layout check for upgradeables
  - TypeScript type-check step
  - Secret scanning (e.g., gitleaks)
  - SBOM generation and dependency review

Example additions:
```yaml
- name: Type check (TS)
  run: tsc --noEmit

- name: Foundry Build & Test
  run: forge build && forge test -vvv

- name: Storage layout check
  run: npx hardhat storage:verify # or custom script

- name: Secret scan
  uses: gitleaks/gitleaks-action@v2
```

Release and Provenance
- Semantic versioning; signed tags; artifact signatures (Sigstore/Cosign); changelog automation; provenance attestations for critical artifacts.

Environment Protections
- Manual approvals for prod; deploy windows; cannot push to prod from non-main; env-level feature flags.

Testing Strategy

Unit, Integration, and E2E
- Unit: deterministic and isolated
- Integration: fork tests against live mainnet state for critical adapters
- E2E: Playwright/Cypress with mocked RPC plus periodic live smoke tests
- **Contract-Test Alignment**: Ensure test expectations exactly match contract behavior (error names, event emissions, data formats)
- **Deployment Testing**: Test actual deployment methods used in production, especially for upgradeable contracts

Property/Fuzz/Invariants
- Expand fuzz ranges; seed variability; snapshot minimal failing cases; run invariants nightly.

Gas and Performance Budgets
- Track budgets per function; alert on deltas > threshold; PR comment bot showing gas diffs.

Coverage
- Aim for meaningful coverage; test negative paths; require coverage thresholds for critical packages.
- **Error Path Coverage**: Test all custom error conditions with correct `revertedWithCustomError()` syntax
- **Event Coverage**: Verify all expected events are emitted and test only events that actually exist in contracts

Monitoring, Observability, and Ops

Runtime Metrics
- RPC latency/error rate; queue depth; indexer lag; block timestamp drift.

Alerting
- On-call rotation; paging on specific classes (reorg size > threshold, stale oracle, failed upgrades).

Incident Response
- Document runbooks; pause/kill switch playbook; communication templates; postmortems and follow-ups.

Backups and DR
- Scheduled DB backups; restore drills; snapshots for indexers; cross-region redundancy.

Governance, Upgrades, and Key Management

Governance Safety
- Multisig with hardware keys; role-based access; timelocks for sensitive actions; on-chain announcements.

Upgrade Safety
- Storage layout checks; canary deployments on testnets; pre/post-upgrade runbooks; simulate upgrades on forks.

Key Rotation and Compromise Handling
- Rotatable admin roles; emergency revocation procedures; segregated keys for deploy, admin, pause, and treasury.

Quick Commands Reference

- Solhint: npx solhint 'contracts/**/*.sol'
- Hardhat compile: npx hardhat compile
- Foundry: forge build && forge test -vvv
- Slither: slither . --filter-paths node_modules
- Conflict markers: git grep -n '<<<<<<<\|=======\|>>>>>>>'
- Diff artifacts: git grep -n '^\s*[+-]\s' -- 'contracts/**/*.sol'
- Type-check: tsc --noEmit
- ESLint: npm run lint
- Prettier: npx prettier --write 'contracts/**/*.sol'
- Gas report (Hardhat): npx hardhat test --grep Gas
- Secret scan: gitleaks detect
- **Find unused imports**: Search for import statements and verify usage with grep
- **Find unused errors**: Search for error definitions and verify they're used in revert statements
- **Find unused modifiers**: Search for modifier definitions and verify they're applied to functions
- **Check upgradeable deployment**: grep -r "ethers.deployContract" test/ (should use upgrades.deployProxy instead)
- **Verify custom error usage**: grep -r "revertedWith(" test/ (should use revertedWithCustomError for custom errors)
- **Check data type lengths**: grep -r "0x[0-9a-fA-F]\{1,7\}[^0-9a-fA-F]" contracts/ (bytes4 needs exactly 8 hex chars)
- **Find external self-calls**: grep -r "this\." contracts/ (avoid for access control functions)

Policy on Rule Suppression (solhint, eslint)
- Narrowest scope; include “why safe” comment; ticket link if applicable.
- Track suppressions in a registry for periodic cleanup.
- PRs adding global disables must be escalated and reviewed by maintainers.

Recent Fixes Applied (2025 Session)

**Unused Code Cleanup:**
- Removed `onlySeller` modifier from `SmartChequeEscrow.sol` (defined but never used)
- Removed `AggregatorV3Interface` import from `ObligationRegistry.sol` (imported but never used)
- Removed `InvalidProof` error from `NativeBridge.sol` (only used in `ERC20Bridge.sol`)
- Removed `TransferFailed` error from `NativeBridge.sol` (obsolete after switching to `Address.sendValue`)
- Added `removeValidator` and `challengeWithdrawal` functions to `ERC20Bridge.sol` to utilize existing events

**Reentrancy Protection Improvements:**
- Replaced raw `call` with `Address.sendValue()` in `NativeBridge.withdrawNativeToken` function
- Replaced raw `call` with `Address.sendValue()` in `NativeBridge.finalizeNativeWithdrawal` function
- Removed unused `GAS_LIMIT` constant after switching to library functions
- Confirmed `MaliciousToken.transferFrom` reentrancy warning is intentional for testing

**ObligationRegistry Test Fixes (January 2025):**

*Bug 1: Incorrect Deployment Method for Upgradeable Contracts*
- **Issue**: Used direct contract deployment instead of `upgrades.deployProxy()` for upgradeable contracts
- **Error**: Contract initialization failed, functions were not accessible
- **Fix**: Changed from `await ethers.deployContract("ObligationRegistry")` to `await upgrades.deployProxy(ObligationRegistryFactory, [admin.address])`
- **Prevention**: Always use OpenZeppelin's upgrades plugin for upgradeable contracts; never deploy upgradeable contracts directly

*Bug 2: Incorrect Data Length for bytes4 Parameters*
- **Issue**: Used `"0x1234"` (2 bytes) for `bytes4` parameter `oracleFunction`
- **Error**: `incorrect data length` error during contract calls
- **Fix**: Changed to `"0x12345678"` (4 bytes) to match `bytes4` requirement
- **Prevention**: Always verify data length matches Solidity type requirements; `bytes4` requires exactly 4 bytes (8 hex characters)

*Bug 3: Outdated Error Handling in Tests*
- **Issue**: Tests used `revertedWith("string message")` instead of `revertedWithCustomError()` for custom errors
- **Error**: Tests failed because contract uses custom errors, not string reverts
- **Fix**: Updated all `revertedWith()` calls to `revertedWithCustomError(contract, "ErrorName")`
- **Prevention**: When contracts use custom errors, always use `revertedWithCustomError()` in tests; maintain consistency between contract error definitions and test expectations

*Bug 4: External Call Context Issues in Contract Functions*
- **Issue**: `updateReliabilityScore()` used `this.updateOracleScore()` causing access control failures
- **Error**: External call changed caller context, breaking `onlyRole` modifier
- **Fix**: Implemented logic directly in function instead of external call
- **Prevention**: Avoid `this.functionName()` calls within the same contract; use internal calls or duplicate logic for alias functions

*Bug 5: Incorrect Custom Error Names in Tests*
- **Issue**: Used `ObligationNotFound` in tests but contract defines `ObligationDoesNotExist`
- **Error**: Test failures due to mismatched error names
- **Fix**: Updated test to use correct error name `ObligationDoesNotExist`
- **Prevention**: Always verify custom error names match exactly between contract definitions and test expectations

*Bug 6: Missing Event Expectations*
- **Issue**: Test expected `MinimumOracleScoreUpdated` event that doesn't exist in contract
- **Error**: Test failure due to non-existent event
- **Fix**: Removed event expectation as `updateMinimumOracleScore` doesn't emit this event
- **Prevention**: Verify all expected events are actually emitted by the contract functions being tested

*Bug 7: Incorrect Parameter Comparison in Tests*
- **Issue**: Used `expect(obligation.parameters).to.equal(parameters)` comparing different data formats
- **Error**: Assertion failed due to format mismatch between input and stored data
- **Fix**: Changed to compare with hex-encoded expected value `"0x7465737420706172616d73"`
- **Prevention**: Understand how Solidity stores and returns data; bytes parameters are returned as hex strings

**Key Lessons Learned:**
1. **Upgradeable Contract Deployment**: Always use proper deployment methods for upgradeable contracts
2. **Data Type Precision**: Verify exact byte lengths for Solidity types (bytes4, bytes32, etc.)
3. **Error Handling Evolution**: Keep tests synchronized with contract error handling patterns
4. **Function Call Context**: Be careful with external vs internal function calls within contracts
5. **Test-Contract Alignment**: Ensure test expectations exactly match contract behavior and definitions
6. **Data Format Understanding**: Know how Solidity encodes and returns different data types

**Verification:**
- All 22 ObligationRegistry tests now pass
- No regressions introduced
- Improved test reliability and accuracy
- Better alignment between contract implementation and test expectations

Additional Notes You Were Missing
- Storage layout verification in CI for upgradeables
- ABI diff checks and versioning in CI
- Multi-provider RPC strategy with quorum reads
- Reorg-aware indexer design with confirmations and replay windows
- Foundry invariants and gas snapshot enforcement
- EIP-2612 and permit implementations with replay protection
- Governance and timelock best practices
- Secret scanning in CI and SBOM/dependency review
- ADRs for key protocol and security decisions
- CSP, SRI, and i18n/a11y requirements for frontend
- Incident response and disaster recovery drills
- Explicit handling for L2/L3 chain quirks and finality

If you want, I can generate a repository-ready docs/ folder with this split into:
- docs/contracts.md
- docs/frontend.md
- docs/backend.md
- docs/security.md
- docs/ci-cd.md
- docs/runbooks/incident-response.md

And add example GitHub Actions, Hardhat config stubs, and Foundry invariant templates.