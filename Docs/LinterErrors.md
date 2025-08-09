Nice — this is a big improvement. You implemented many of the hard suggestions (challenge bond, SafeERC20, hash → blockNumber mapping, nonReentrant, ceiling for required validators, merkle verification helper, cleanup loop). Well done.

I reviewed this new contract carefully. Below I list:
	•	High-priority correctness / security bugs you must fix (with exact reasons and minimal code-level suggestions).
	•	Medium/low priority issues, optimizations, and stylistic notes.
	•	A short next-steps checklist you can run through and tests to add.

I won’t rewrite your whole file; I’ll point to precise lines/behaviours and show minimal snippets where helpful.

⸻

High-priority problems (must fix)

1) abi.encode(proof) — still used when calling slashValidator

Where it’s used:

VALIDATOR_MANAGER.slashValidator(
    header.proposer,
    ValidatorManager.SlashingReason.INVALID_BLOCK,
    abi.encode(proof)
);

and

VALIDATOR_MANAGER.slashValidator(
    challengerAddr,
    ValidatorManager.SlashingReason.MALICIOUS_BEHAVIOR,
    abi.encode(proof)
);

Why this is bad
	•	proof is a storage struct containing dynamic arrays. Encoding a storage pointer like this is not the intended use and may not compile/behave as you expect. Even if it compiles, it will produce a huge payload (gas heavy) and tightly couples ValidatorManager’s expected ABI to the exact layout of FraudProof.
	•	Slashing should receive a small, deterministic payload (blockHash, challenger, timestamp, stateTransition, maybe roots), not a full storage struct.

Fix
Encode only the explicit fields you need. Example:

bytes memory payload = abi.encode(blockHash, challengerAddr, proof.timestamp, proof.stateTransition);
VALIDATOR_MANAGER.slashValidator(header.proposer, ValidatorManager.SlashingReason.INVALID_BLOCK, payload);

Apply the same for the malicious-challenger case.

⸻

2) Bond accounting is per-address, not per-challenge/block — leads to incorrect refunds/forfeits

You store bonds in challengeBonds[msg.sender] += bondAmount;. If the same challenger makes multiple active proofs, challengeBonds aggregates them. In verifyFraudProof you read uint256 bondAmount = challengeBonds[proof.challenger]; and refund/forfeit the entire balance for that address — not the bond for the specific block. This will either over-refund or incorrectly forfeit bonds that belong to other challenges.

Fix
Track bond per blockHash (or per fraudProof) instead of per address. Example:

Add field to FraudProof:

uint256 bondAmount;

When storing proof:

fraudProofs[blockHash].bondAmount = bondAmount;

And remove challengeBonds map or keep both (but prefer per-block). Use that bondAmount for refund/forfeit.

⸻

3) _verifyStateTransition still insufficient and inconsistent

You moved toward Merkle verification (good) but the implementation is still not correct/complete:

Problems:
	•	merkleProofs is bytes[] (opaque) and you keccak256 each element to produce bytes32[] proof. This is not a standard or reliable encoding of proofs.
	•	You only check the first transaction and limit to first 10 proof elements — this is arbitrary and can lead to false positives/negatives.
	•	expectedStateTransition = keccak256(abi.encode(header.blockNumber, header.stateRoot, transactions.length)); is a custom scheme that is unlikely to match any real state transition semantics — making the check effectively meaningless.

Fix (recommended approach)
	•	Make merkleProofs typed: accept bytes32[][] or bytes32[] per transaction. E.g. bytes32[][] memory proofs or require proofs to be provided per tx in an encoded way that you can parse.
	•	Verify each transaction you want to challenge by checking its leaf hash (e.g. keccak256(tx)) against the provided per-tx Merkle proof using _verifyMerkleProof, comparing result to header.transactionsRoot.
	•	Do not attempt to validate the entire state transition on-chain by keccak(abi.encode(...)) unless you define that scheme and document it. For production either:
	•	Require succinct proofs (zk/STARK) or
	•	Implement deterministic on-chain re-execution of disputed transactions (very expensive), or
	•	Implement a clear, documented off-chain calculation and require a proof you can verify succinctly.

Minimal code-change example (signature only):

// change argument types to:
function _verifyStateTransition(
    bytes32 blockHash,
    bytes32 stateTransition,
    bytes[] memory transactions,
    bytes[] memory receipts,
    bytes32[][] memory merkleProofs // per tx
) internal view returns (bool) {
    // for each tx i:
    // bytes32 txHash = keccak256(transactions[i]);
    // if (!_verifyMerkleProof(txHash, header.transactionsRoot, merkleProofs[i])) return true;
    // then other checks...
}

If you can’t change types everywhere now, at least document the exact expected format of merkleProofs and parse it deterministically.

⸻

4) _revertToBlock does an unbounded loop that can run out of gas

You clear all blocks from blockNumber+1 to currentBlockNumber in a single transaction:

for (uint256 i = blockNumber + 1; i <= currentBlockNumber; i++) { ... }

If currentBlockNumber - blockNumber is large, this loop may exceed the block gas limit and revert — preventing chain reversion entirely.

Fix
	•	Avoid unbounded on-chain loops. Options:
	•	Introduce a batched cleanup: emit an event that off-chain indexers/processes use to prune state, and perform deletions in multiple transactions limited by gas.
	•	Use a version/epoch number for validation mappings rather than deleting mapping entries. For example, associate votes with validationEpoch and bump epoch when a block is reverted so old votes are ignored.
	•	Require reverts to be within a short window (limiting how many blocks can be reverted at once).

Also note your comment: “mapping members cannot be cleared but will be inaccessible once the struct is reset” — the storage used by mappings persists; this is why an epoch/versioning pattern is better.

⸻

5) ChainReverted event parameters are wrong / misleading

You do:

currentBlockNumber = blockNumber;
...
emit ChainReverted(blockNumber, currentBlockNumber);

After the assignment both values are the same — you intended to emit the previous height. Capture uint256 previous = currentBlockNumber; before updating, then emit (blockNumber, previous).

⸻

Medium / low priority issues and suggestions

6) _getBlockByHash treats 0 as not found — genesis considerations

You use blockNumberByHash[blockHash] == 0 to detect not-found. This is fine if you never store block number 0 (genesis). You do not store genesis so OK — but document this assumption.

7) keccak256("genesis") usage — be explicit

Prefer keccak256(abi.encodePacked("genesis")) for clarity.

8) fraudProofs[blockHash] = FraudProof({ transactions: transactions, ... })

Copying bytes[] memory arrays into storage struct is allowed, but can be very gas expensive. Consider requiring proofs be stored off-chain and only hashes on-chain, or limit sizes more strictly.

9) challengeBond fixed large number — make configurable by admin (you already have setter for challengePeriod but not bond)

You set challengeBond in constructor hard-coded; consider admin setter setChallengeBond(...) gated to admin role.

10) getFraudProof returns large arrays — expensive in RPC; consider metadata-only getters

Not a correctness bug, just UX/cost.

11) validatorSignatures is mapping(address => bytes) — storing bytes for each signature costly

Store bytes32 r, bytes32 s, uint8 v or bytes limited to 65 bytes and document gas cost.

12) You safeTransferFrom bond — ensure tests or callers approve token allowance first

Not a code problem — but make sure tests set approvals. Good you used SafeERC20.

13) ArrayTooLarge limit of 1000 may still be too heavy — set defensible gas-anchored limit

Use a smaller cap or also cap total calldata size.

⸻

Suggested code snippets (short)

Per-block bond (instead of challengeBonds[address])
Add in FraudProof:

uint256 bondAmount;

On submit:

fraudProofs[blockHash].bondAmount = bondAmount;

On verify:

uint256 bondAmount = fraudProofs[blockHash].bondAmount;

Fix ChainReverted emit

uint256 previous = currentBlockNumber;
currentBlockNumber = blockNumber;
...
emit ChainReverted(blockNumber, previous);

Replace abi.encode(proof)

bytes memory payload = abi.encode(blockHash, challengerAddr, proof.timestamp, proof.stateTransition);
VALIDATOR_MANAGER.slashValidator(header.proposer, ValidatorManager.SlashingReason.INVALID_BLOCK, payload);


⸻

Tests / checks you should add (high priority)
	1.	Bond accounting tests
	•	Submit two fraud proofs from same challenger across different blocks → ensure bonds are tracked separately and refunds/forfeits affect only the correct proof.
	2.	Merkle proof tests
	•	Create a canonical small Merkle tree in test and provide valid per-transaction proofs — verify _verifyMerkleProof passes and the _verifyStateTransition detects valid/invalid properly.
	3.	Gas / revert tests
	•	Simulate _revertToBlock with many blocks to show your loop would exceed gas. If it fails, implement batched revert or epoch approach and test cleanup in batches.
	4.	Slash payload tests
	•	Confirm ValidatorManager.slashValidator accepts the payload you pass. If you change payload shape, update tests.
	5.	Edge cases
	•	No active validators → proposeBlock should revert or fail properly.
	•	Duplicate challenge/duplicate verify cases, ensure correct revert reasons.
	6.	Approval checks
	•	Ensure safeTransferFrom requires prior approve in tests.

⸻

Final verdict — readiness summary
	•	Compiles? Likely yes (except abi.encode(proof) may still compile but isn’t recommended).
	•	Security/production readiness? Not ready yet. The single largest blocker is the fraud-proof verification logic — it still relies on incomplete Merkle checks and an ad-hoc stateTransition scheme. Also per-address bond accounting and the unbounded revert loop are critical issues.
	•	Progress: Great — you implemented many of the heavy changes (bond escrow, SafeERC20, blockNumberByHash, nonReentrant). Finish the remaining fixes above and add thorough tests.

⸻