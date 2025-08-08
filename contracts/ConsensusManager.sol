// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ValidatorManager} from "./ValidatorManager.sol";

/**
 * @title ConsensusManager
 * @dev Manages consensus mechanism, block production, and validation
 * @notice Implements Proof of Stake consensus with fraud proofs
 */
contract ConsensusManager is AccessControl, ReentrancyGuard, Pausable {
    using ECDSA for bytes32;
    
    // Custom errors
    error InvalidBlockNumber();
    error InvalidParentHash();
    error InvalidProposer();
    error BlockAlreadyExists();
    error BlockNotFound();
    error InvalidSignature();
    error InsufficientValidators();
    error BlockAlreadyFinalized();
    error InvalidFraudProof();
    error InvalidChallengePeriod();
    error ChallengeAlreadyExists();
    error ChallengeNotFound();
    error InvalidChallengeState();
    error UnauthorizedAccess();
    error InvalidTimestamp();
    error InvalidStateRoot();
    error InvalidTransactionsRoot();
    error InvalidReceiptsRoot();
    error InvalidGasLimit();
    error InvalidDifficulty();
    error BlockTooOld();
    error InvalidValidatorSet();
    
    // Roles
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
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
        _grantRole(ADMIN_ROLE, msg.sender);
        
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
        if (gasUsed > baseGasLimit) revert InvalidGasLimit();
        if (extraData.length > 32) revert InvalidDifficulty();
        if (block.timestamp < lastProposedBlock[msg.sender] + blockTime) revert InvalidTimestamp();
        
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
        if (validation.blockHash == bytes32(0)) revert BlockNotFound();
        if (validation.finalized) revert BlockAlreadyFinalized();
        if (validation.validatorVotes[msg.sender]) revert UnauthorizedAccess();
        if (block.timestamp > validation.challengeDeadline) revert InvalidChallengePeriod();
        
        // Verify signature
        bytes32 messageHash = ECDSA.toEthSignedMessageHash(blockHash);
        address signer = messageHash.recover(signature);
        if (signer != msg.sender) revert InvalidSignature();
        
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
        if (validation.blockHash == bytes32(0)) revert BlockNotFound();
        if (validation.finalized) revert BlockAlreadyFinalized();
        if (validation.challenged) revert ChallengeAlreadyExists();
        if (block.timestamp > validation.challengeDeadline) revert InvalidChallengePeriod();

        // Verify caller has sufficient stake
        (uint256 callerStake, bool isActive) = validatorManager.getValidatorStake(msg.sender);
        if (callerStake == 0 || !isActive) revert UnauthorizedAccess();

        // Mark as challenged and extend challenge window
        validation.challenged = true;
        validation.challenger = msg.sender;
        validation.challengeDeadline = block.timestamp + challengePeriod;
        
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
    function verifyFraudProof(bytes32 blockHash) external onlyRole(ORACLE_ROLE) whenNotPaused {
        FraudProof storage proof = fraudProofs[blockHash];
        if (proof.blockHash == bytes32(0)) revert InvalidFraudProof();
        if (proof.verified) revert InvalidFraudProof();
        if (proof.resolved) revert InvalidFraudProof();

        BlockValidation storage validation = blockValidations[blockHash];
        if (!validation.challenged) revert ChallengeNotFound();
        if (block.timestamp > validation.challengeDeadline) revert InvalidChallengePeriod();

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
            
            // Reward the challenger
            (uint256 challengerStake, bool challengerActive) = validatorManager.getValidatorStake(proof.challenger);
            if (challengerStake > 0 && challengerActive) {
                // Transfer reward to challenger
                IERC20 governanceToken = IERC20(address(validatorManager.governanceToken()));
                SafeERC20.safeTransfer(governanceToken, proof.challenger, challengerStake / 10);
            }
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
        if (blockNumber > lastFinalizedBlock) revert BlockNotFound();
        if (blockNumber < lastCheckpointBlock + checkpointInterval) revert BlockTooOld();
        
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
        if (blockNumber >= currentBlockNumber) revert InvalidBlockNumber();
        
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
        if (_threshold <= 50 || _threshold > 100) revert InvalidValidatorSet();
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

    /**
     * @dev Grant oracle role to an address
     * @param oracle Address to grant oracle role
     */
    function grantOracleRole(address oracle) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (oracle == address(0)) revert UnauthorizedAccess();
        _grantRole(ORACLE_ROLE, oracle);
    }

    /**
     * @dev Revoke oracle role from an address
     * @param oracle Address to revoke oracle role
     */
    function revokeOracleRole(address oracle) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(ORACLE_ROLE, oracle);
    }

    /**
     * @dev Grant validator role to an address
     * @param validator Address to grant validator role
     */
    function grantValidatorRole(address validator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (validator == address(0)) revert UnauthorizedAccess();
        _grantRole(VALIDATOR_ROLE, validator);
    }

    /**
     * @dev Revoke validator role from an address
     * @param validator Address to revoke validator role
     */
    function revokeValidatorRole(address validator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(VALIDATOR_ROLE, validator);
    }

    /**
     * @dev Grant sequencer role to an address
     * @param sequencer Address to grant sequencer role
     */
    function grantSequencerRole(address sequencer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (sequencer == address(0)) revert UnauthorizedAccess();
        _grantRole(SEQUENCER_ROLE, sequencer);
    }

    /**
     * @dev Revoke sequencer role from an address
     * @param sequencer Address to revoke sequencer role
     */
    function revokeSequencerRole(address sequencer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(SEQUENCER_ROLE, sequencer);
    }

    /**
     * @dev Batch setup roles for initial configuration
     * @param oracles Array of oracle addresses
     * @param validators Array of validator addresses
     * @param sequencers Array of sequencer addresses
     */
    function batchSetupRoles(
        address[] calldata oracles,
        address[] calldata validators,
        address[] calldata sequencers
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (oracles.length > 20) revert InvalidValidatorSet();
        if (validators.length > 50) revert InvalidValidatorSet();
        if (sequencers.length > 10) revert InvalidValidatorSet();
        
        // Grant oracle roles
        for (uint256 i = 0; i < oracles.length; i++) {
            if (oracles[i] != address(0)) {
                _grantRole(ORACLE_ROLE, oracles[i]);
            }
        }
        
        // Grant validator roles
        for (uint256 i = 0; i < validators.length; i++) {
            if (validators[i] != address(0)) {
                _grantRole(VALIDATOR_ROLE, validators[i]);
            }
        }
        
        // Grant sequencer roles
        for (uint256 i = 0; i < sequencers.length; i++) {
            if (sequencers[i] != address(0)) {
                _grantRole(SEQUENCER_ROLE, sequencers[i]);
            }
        }
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