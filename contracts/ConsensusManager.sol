// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./ValidatorManager.sol";

/**
 * @title ConsensusManager
 * @dev Manages consensus mechanism, block production, and validation
 * @notice Implements Proof of Stake consensus with fraud proofs
 */
contract ConsensusManager is AccessControl, ReentrancyGuard, Pausable {
    using ECDSA for bytes32;
    
    // Roles
    bytes32 public constant SEQUENCER_ROLE = keccak256("SEQUENCER_ROLE");
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    
    // Block structure
    struct BlockHeader {
        uint256 blockNumber;
        bytes32 parentHash;
        bytes32 stateRoot;
        bytes32 transactionsRoot;
        uint256 timestamp;
        address proposer;
        uint256 gasLimit;
        uint256 gasUsed;
        bytes32 receiptsRoot;
        uint256 difficulty;
        bytes extraData;
    }
    
    // Block validation info
    struct BlockValidation {
        bytes32 blockHash;
        uint256 validatorCount;
        uint256 requiredValidators;
        mapping(address => bool) validatorVotes;
        mapping(address => bytes) validatorSignatures;
        bool finalized;
        uint256 finalizedAt;
        bool challenged;
        address challenger;
        uint256 challengeDeadline;
    }
    
    // Fraud proof structure
    struct FraudProof {
        bytes32 blockHash;
        bytes32 stateTransition;
        bytes[] transactions;
        bytes[] receipts;
        bytes[] merkleProofs;
        address challenger;
        uint256 timestamp;
        bool verified;
        bool resolved;
    }
    
    // Checkpoint structure
    struct Checkpoint {
        uint256 blockNumber;
        bytes32 blockHash;
        bytes32 stateRoot;
        uint256 timestamp;
        uint256 validatorSetHash;
        bool finalized;
    }
    
    // State variables
    ValidatorManager public immutable validatorManager;
    
    mapping(uint256 => BlockHeader) private blockHeaders;
    mapping(bytes32 => BlockValidation) private blockValidations;
    mapping(bytes32 => FraudProof) private fraudProofs;
    mapping(uint256 => Checkpoint) private checkpoints;
    mapping(address => uint256) public lastProposedBlock;
    mapping(bytes32 => bool) public processedTransactions;
    
    uint256 public currentBlockNumber;
    uint256 public lastFinalizedBlock;
    uint256 public lastCheckpointBlock;
    bytes32 public currentStateRoot;
    
    // Configuration
    uint256 public blockTime = 12; // 12 seconds
    uint256 public validationThreshold = 67; // 67% of validators must validate
    uint256 public challengePeriod = 7 days;
    uint256 public checkpointInterval = 256; // blocks
    uint256 public maxBlockSize = 1000000; // 1MB
    uint256 public baseGasLimit = 30000000;
    
    // Events
    event BlockProposed(
        uint256 indexed blockNumber,
        bytes32 indexed blockHash,
        address indexed proposer,
        bytes32 parentHash
    );
    
    event BlockValidated(
        bytes32 indexed blockHash,
        address indexed validator,
        bytes signature
    );
    
    event BlockFinalized(
        uint256 indexed blockNumber,
        bytes32 indexed blockHash,
        uint256 validatorCount
    );
    
    event FraudProofSubmitted(
        bytes32 indexed blockHash,
        address indexed challenger,
        bytes32 stateTransition
    );
    
    event FraudProofVerified(
        bytes32 indexed blockHash,
        bool valid,
        address challenger
    );
    
    event CheckpointCreated(
        uint256 indexed blockNumber,
        bytes32 indexed blockHash,
        bytes32 stateRoot
    );
    
    constructor(address _validatorManager) {
        validatorManager = ValidatorManager(_validatorManager);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(SEQUENCER_ROLE, msg.sender);
        
        // Initialize genesis block
        currentBlockNumber = 0;
        currentStateRoot = keccak256("genesis");
    }
    
    /**
     * @dev Propose a new block
     * @param parentHash Hash of the parent block
     * @param stateRoot New state root after transactions
     * @param transactionsRoot Merkle root of transactions
     * @param receiptsRoot Merkle root of transaction receipts
     * @param gasUsed Total gas used in block
     * @param extraData Additional block data
     */
    function proposeBlock(
        bytes32 parentHash,
        bytes32 stateRoot,
        bytes32 transactionsRoot,
        bytes32 receiptsRoot,
        uint256 gasUsed,
        bytes memory extraData
    ) external onlyRole(SEQUENCER_ROLE) whenNotPaused {
        require(gasUsed <= baseGasLimit, "Gas limit exceeded");
        require(extraData.length <= 32, "Extra data too large");
        require(
            block.timestamp >= lastProposedBlock[msg.sender] + blockTime,
            "Block time not elapsed"
        );
        
        uint256 newBlockNumber = currentBlockNumber + 1;
        
        // Create block header
        BlockHeader memory header = BlockHeader({
            blockNumber: newBlockNumber,
            parentHash: parentHash,
            stateRoot: stateRoot,
            transactionsRoot: transactionsRoot,
            timestamp: block.timestamp,
            proposer: msg.sender,
            gasLimit: baseGasLimit,
            gasUsed: gasUsed,
            receiptsRoot: receiptsRoot,
            difficulty: 1, // Fixed difficulty for PoS
            extraData: extraData
        });
        
        bytes32 blockHash = _calculateBlockHash(header);
        
        // Store block header
        blockHeaders[newBlockNumber] = header;
        
        // Initialize block validation
        BlockValidation storage validation = blockValidations[blockHash];
        validation.blockHash = blockHash;
        validation.requiredValidators = _calculateRequiredValidators();
        validation.challengeDeadline = block.timestamp + challengePeriod;
        
        // Update state
        currentBlockNumber = newBlockNumber;
        currentStateRoot = stateRoot;
        lastProposedBlock[msg.sender] = block.timestamp;
        
        emit BlockProposed(newBlockNumber, blockHash, msg.sender, parentHash);
    }
    
    /**
     * @dev Validate a proposed block
     * @param blockHash Hash of the block to validate
     * @param signature Validator's signature
     */
    function validateBlock(bytes32 blockHash, bytes memory signature) 
        external 
        onlyRole(VALIDATOR_ROLE) 
        whenNotPaused 
    {
        BlockValidation storage validation = blockValidations[blockHash];
        require(validation.blockHash != bytes32(0), "Block not found");
        require(!validation.finalized, "Block already finalized");
        require(!validation.validatorVotes[msg.sender], "Already validated");
        require(block.timestamp <= validation.challengeDeadline, "Challenge period expired");
        
        // Verify signature
        bytes32 messageHash = ECDSA.toEthSignedMessageHash(blockHash);
        address signer = messageHash.recover(signature);
        require(signer == msg.sender, "Invalid signature");
        
        // Record validation
        validation.validatorVotes[msg.sender] = true;
        validation.validatorSignatures[msg.sender] = signature;
        validation.validatorCount++;
        
        emit BlockValidated(blockHash, msg.sender, signature);
        
        // Check if block can be finalized
        if (validation.validatorCount >= validation.requiredValidators) {
            _finalizeBlock(blockHash);
        }
    }
    
    /**
     * @dev Submit a fraud proof against a block
     * @param blockHash Hash of the fraudulent block
     * @param stateTransition Claimed state transition
     * @param transactions Transactions in the block
     * @param receipts Transaction receipts
     * @param merkleProofs Merkle proofs for verification
     */
    function submitFraudProof(
        bytes32 blockHash,
        bytes32 stateTransition,
        bytes[] memory transactions,
        bytes[] memory receipts,
        bytes[] memory merkleProofs
    ) external whenNotPaused {
        BlockValidation storage validation = blockValidations[blockHash];
        require(validation.blockHash != bytes32(0), "Block not found");
        require(!validation.finalized, "Block already finalized");
        require(block.timestamp <= validation.challengeDeadline, "Challenge period expired");
        require(!validation.challenged, "Already challenged");
        
        // Mark as challenged
        validation.challenged = true;
        validation.challenger = msg.sender;
        
        // Store fraud proof
        fraudProofs[blockHash] = FraudProof({
            blockHash: blockHash,
            stateTransition: stateTransition,
            transactions: transactions,
            receipts: receipts,
            merkleProofs: merkleProofs,
            challenger: msg.sender,
            timestamp: block.timestamp,
            verified: false,
            resolved: false
        });
        
        emit FraudProofSubmitted(blockHash, msg.sender, stateTransition);
    }
    
    /**
     * @dev Verify a fraud proof
     * @param blockHash Hash of the challenged block
     */
    function verifyFraudProof(bytes32 blockHash) external onlyRole(ORACLE_ROLE) {
        FraudProof storage proof = fraudProofs[blockHash];
        require(proof.blockHash != bytes32(0), "Fraud proof not found");
        require(!proof.resolved, "Fraud proof already resolved");
        
        // Verify the fraud proof (simplified - in production would need full verification)
        bool isValid = _verifyStateTransition(
            proof.stateTransition,
            proof.transactions,
            proof.receipts,
            proof.merkleProofs
        );
        
        proof.verified = isValid;
        proof.resolved = true;
        
        if (isValid) {
            // Fraud proven - slash the block proposer
            BlockHeader memory header = _getBlockByHash(blockHash);
            validatorManager.slashValidator(
                header.proposer,
                ValidatorManager.SlashingReason.INVALID_BLOCK,
                abi.encode(proof)
            );
            
            // Revert to previous state
            _revertToBlock(header.blockNumber - 1);
        } else {
            // Fraud proof invalid - slash the challenger
            validatorManager.slashValidator(
                proof.challenger,
                ValidatorManager.SlashingReason.MALICIOUS_BEHAVIOR,
                abi.encode(proof)
            );
        }
        
        emit FraudProofVerified(blockHash, isValid, proof.challenger);
    }
    
    /**
     * @dev Create a checkpoint for finalized blocks
     * @param blockNumber Block number to checkpoint
     */
    function createCheckpoint(uint256 blockNumber) external onlyRole(ORACLE_ROLE) {
        require(blockNumber <= lastFinalizedBlock, "Block not finalized");
        require(blockNumber >= lastCheckpointBlock + checkpointInterval, "Too early for checkpoint");
        
        BlockHeader memory header = blockHeaders[blockNumber];
        bytes32 validatorSetHash = _calculateValidatorSetHash();
        
        checkpoints[blockNumber] = Checkpoint({
            blockNumber: blockNumber,
            blockHash: _calculateBlockHash(header),
            stateRoot: header.stateRoot,
            timestamp: block.timestamp,
            validatorSetHash: uint256(validatorSetHash),
            finalized: true
        });
        
        lastCheckpointBlock = blockNumber;
        
        emit CheckpointCreated(blockNumber, _calculateBlockHash(header), header.stateRoot);
    }
    
    /**
     * @dev Finalize a block after sufficient validation
     * @param blockHash Hash of the block to finalize
     */
    function _finalizeBlock(bytes32 blockHash) internal {
        BlockValidation storage validation = blockValidations[blockHash];
        validation.finalized = true;
        validation.finalizedAt = block.timestamp;
        
        BlockHeader memory header = _getBlockByHash(blockHash);
        lastFinalizedBlock = header.blockNumber;
        
        // Record block production for validator rewards
        validatorManager.recordBlockProduction(header.proposer, header.blockNumber);
        
        emit BlockFinalized(header.blockNumber, blockHash, validation.validatorCount);
    }
    
    /**
     * @dev Calculate required number of validators for consensus
     * @return Required validator count
     */
    function _calculateRequiredValidators() internal view returns (uint256) {
        address[] memory activeValidators = validatorManager.getActiveValidators();
        return (activeValidators.length * validationThreshold) / 100;
    }
    
    /**
     * @dev Calculate block hash from header
     * @param header Block header
     * @return Block hash
     */
    function _calculateBlockHash(BlockHeader memory header) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            header.blockNumber,
            header.parentHash,
            header.stateRoot,
            header.transactionsRoot,
            header.timestamp,
            header.proposer,
            header.gasLimit,
            header.gasUsed,
            header.receiptsRoot,
            header.difficulty,
            header.extraData
        ));
    }
    
    /**
     * @dev Get block header by hash
     * @param blockHash Block hash
     * @return Block header
     */
    function _getBlockByHash(bytes32 blockHash) internal view returns (BlockHeader memory) {
        for (uint256 i = 1; i <= currentBlockNumber; i++) {
            if (_calculateBlockHash(blockHeaders[i]) == blockHash) {
                return blockHeaders[i];
            }
        }
        revert("Block not found");
    }
    
    /**
     * @dev Verify state transition (simplified)
     * @param stateTransition State transition hash
     * @param transactions Transaction data
     * @param receipts Receipt data
     * @param merkleProofs Merkle proofs
     * @return True if valid
     */
    function _verifyStateTransition(
        bytes32 stateTransition,
        bytes[] memory transactions,
        bytes[] memory receipts,
        bytes[] memory merkleProofs
    ) internal pure returns (bool) {
        // Simplified verification - in production would need full EVM execution
        return keccak256(abi.encode(transactions, receipts, merkleProofs)) == stateTransition;
    }
    
    /**
     * @dev Calculate validator set hash
     * @return Validator set hash
     */
    function _calculateValidatorSetHash() internal view returns (bytes32) {
        address[] memory activeValidators = validatorManager.getActiveValidators();
        return keccak256(abi.encode(activeValidators));
    }
    
    /**
     * @dev Revert blockchain state to a previous block
     * @param blockNumber Block number to revert to
     */
    function _revertToBlock(uint256 blockNumber) internal {
        require(blockNumber < currentBlockNumber, "Cannot revert to future block");
        
        currentBlockNumber = blockNumber;
        currentStateRoot = blockHeaders[blockNumber].stateRoot;
        lastFinalizedBlock = blockNumber;
    }
    
    // View functions
    function getBlockHeader(uint256 blockNumber) external view returns (BlockHeader memory) {
        return blockHeaders[blockNumber];
    }
    
    function getBlockValidation(bytes32 blockHash) external view returns (
        uint256 validatorCount,
        uint256 requiredValidators,
        bool finalized,
        bool challenged
    ) {
        BlockValidation storage validation = blockValidations[blockHash];
        return (
            validation.validatorCount,
            validation.requiredValidators,
            validation.finalized,
            validation.challenged
        );
    }
    
    function getFraudProof(bytes32 blockHash) external view returns (FraudProof memory) {
        return fraudProofs[blockHash];
    }
    
    function getCheckpoint(uint256 blockNumber) external view returns (Checkpoint memory) {
        return checkpoints[blockNumber];
    }
    
    // Governance functions
    function setBlockTime(uint256 _blockTime) external onlyRole(DEFAULT_ADMIN_ROLE) {
        blockTime = _blockTime;
    }
    
    function setValidationThreshold(uint256 _threshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_threshold > 50 && _threshold <= 100, "Invalid threshold");
        validationThreshold = _threshold;
    }
    
    function setChallengePeriod(uint256 _period) external onlyRole(DEFAULT_ADMIN_ROLE) {
        challengePeriod = _period;
    }
    
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }
    
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // Individual getter functions for complex structs
    function getBlockHeaderDetails(uint256 blockNumber) external view returns (
        uint256 number,
        bytes32 parentHash,
        bytes32 stateRoot,
        bytes32 transactionsRoot,
        uint256 timestamp,
        address proposer
    ) {
        BlockHeader storage header = blockHeaders[blockNumber];
        return (
            header.blockNumber,
            header.parentHash,
            header.stateRoot,
            header.transactionsRoot,
            header.timestamp,
            header.proposer
        );
    }

    function getBlockValidationStatus(bytes32 blockHash) external view returns (
        uint256 validatorCount,
        uint256 requiredValidators,
        bool finalized,
        bool challenged
    ) {
        BlockValidation storage validation = blockValidations[blockHash];
        return (
            validation.validatorCount,
            validation.requiredValidators,
            validation.finalized,
            validation.challenged
        );
    }

    function getFraudProofStatus(bytes32 blockHash) external view returns (
        address challenger,
        uint256 timestamp,
        bool verified,
        bool resolved
    ) {
        FraudProof storage proof = fraudProofs[blockHash];
        return (
            proof.challenger,
            proof.timestamp,
            proof.verified,
            proof.resolved
        );
    }

    function getCheckpointDetails(uint256 blockNumber) external view returns (
        bytes32 blockHash,
        bytes32 stateRoot,
        uint256 timestamp,
        bool finalized
    ) {
        Checkpoint storage checkpoint = checkpoints[blockNumber];
        return (
            checkpoint.blockHash,
            checkpoint.stateRoot,
            checkpoint.timestamp,
            checkpoint.finalized
        );
    }
}