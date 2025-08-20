Security Runbook: Upgrades and Emergency Actions

Upgrade Flow (UUPS)
- Prepare implementation: deploy new implementation and verify storage layout.
- Propose via Governor:
  - `GOVERNOR_ADDRESS=... PROXY_ADDRESS=... IMPLEMENTATION_ADDRESS=... DESCRIPTION="Upgrade X" pnpm hardhat run scripts/propose-upgrade.ts --network <net>`
- Vote and wait for voting period.
- Queue and Execute after Timelock delay:
  - Encode calldata: `upgradeTo(newImpl)`; or reuse output from propose.
  - `GOVERNOR_ADDRESS=... TARGET=... CALLDATA=0x... DESCRIPTION="Upgrade X" pnpm hardhat run scripts/queue-execute.ts --network <net>`

Beacon Upgrade via Factory
- Propose `SmartChequeFactory.updateEscrowImplementation(newImpl)` and follow the same queue/execute steps.

Emergency Actions
- Pause critical contracts via governance proposals.
- Increase timelock delay via governance if needed.
- Avoid enabling emergency fast paths in production unless necessary and always via governance.

Multisig Operations
- Use Gnosis Safe as Timelock EXECUTOR and optionally as DEFAULT_ADMIN on Timelock.
- Document signer rotation, recovery, and hardware wallet requirements.
- Break-glass: propose to pause contracts, raise minDelay, and revoke non-essential roles.

Role Hygiene
- Timelock holds DEFAULT_ADMIN/ADMIN and UPGRADER roles; EOAs do not.
- Multisig as EXECUTOR or allow `address(0)` (anyone) per policy.

