# Linter Suggestions Implementation Checklist

## High Priority Issues (Must Fix)

### 1) - [x] Fix abi.encode(proof) in slashValidator calls
**Location**: Lines with `VALIDATOR_MANAGER.slashValidator(proposer, INVALID_BLOCK, abi.encode(proof))` and similar
**Problem**: Encoding entire storage struct, gas heavy
**Fix**: Encode only specific fields (blockHash, challenger, timestamp, stateTransition)

### 2) - [x] Fix per-address bond tracking → per-block bond tracking  
**Problem**: `challengeBonds[msg.sender]` aggregates all bonds from same address, leading to incorrect refunds/forfeits
**Fix**: Add `bondAmount` field to FraudProof struct, remove or supplement challengeBonds map

### 3) - [x] Fix _verifyStateTransition implementation
**Problems**: 
- `merkleProofs` as bytes[] is unreliable
- Only checks first transaction with arbitrary 10 proof limit
- Custom stateTransition scheme is meaningless
**Fix**: Use typed merkleProofs, verify each transaction properly

### 4) - [x] Fix unbounded loop in _revertToBlock
**Problem**: Loop may exceed block gas limit for many blocks
**Fix**: Use epoch/versioning or batched cleanup

### 5) - [x] Fix ChainReverted event parameters
**Problem**: emits same blockNumber twice instead of old and new heights
**Fix**: Capture previous height before updating

## Medium/Low Priority Issues

### 6) - [ ] Review _getBlockByHash genesis assumption
**Current**: Uses `blockNumberByHash[blockHash] == 0` to detect not-found
**Action**: Document assumption that genesis (block 0) is never stored

### 7) - [ ] Make keccak256("genesis") usage explicit
**Current**: `keccak256("genesis")`
**Fix**: Use `keccak256(abi.encodePacked("genesis"))`

### 8) - [ ] Consider gas optimization for fraudProofs storage
**Current**: Stores full transaction arrays in storage
**Fix**: Store only hashes or limit sizes more strictly

### 9) - [ ] Add admin setter for challengeBond
**Current**: Hard-coded in constructor
**Fix**: Add `setChallengeBond()` method with admin role access

### 10) - [ ] Add metadata-only getters for fraudProofs
**Current**: `getFraudProof` returns large arrays
**Action**: Add alternative getters for metadata-only

### 11) - [ ] Optimize validatorSignatures storage
**Current**: `mapping(address => bytes)` storing full bytes
**Fix**: Store `bytes32 r, bytes32 s, uint8 v` for gas efficiency

### 12) - [ ] Ensure tests handle SafeERC20 approvals
**Current**: Uses SafeERC20 correctly
**Action**: Add tests that check proper approval setup

### 13) - [ ] Review ArrayTooLarge limits
**Current**: 1000 limit may be too heavy
**Fix**: Set smaller cap or calldata size limits

## Required Tests

### Test Category 1: Bond Accounting
- [ ] Submit two fraud proofs from same challenger across different blocks
- [ ] Verify bonds are tracked separately
- [ ] Verify refunds/forfeits affect only correct proof

### Test Category 2: Merkle Proof Verification
- [ ] Create canonical small Merkle tree in tests
- [ ] Provide valid per-transaction proofs
- [ ] Verify _verifyMerkleProof passes correctly
- [ ] Verify _verifyStateTransition detects valid/invalid properly

### Test Category 3: Gas & Revert Tests
- [ ] Simulate _revertToBlock with many blocks
- [ ] Test that loop would exceed gas limit
- [ ] Implement and test batched revert or epoch approach

### Test Category 4: Slash Payload Tests
- [ ] Confirm ValidatorManager.slashValidator accepts payloads
- [ ] Update tests if payload shape changes

### Test Category 5: Edge Cases
- [ ] Test no active validators → proper proposeBlock behavior
- [ ] Test duplicate challenge/duplicate verify cases
- [ ] Verify correct revert reasons

### Test Category 6: Approval Checks
- [ ] Ensure safeTransferFrom requires proper approve in tests

## Implementation Priority
1. Start with High Priority Issues 1-5 (security critical)
2. Then add required tests
3. Finally address Medium/Low Priority Issues
4. Compile and test entire contract after each major change