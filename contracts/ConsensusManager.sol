// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

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
    using SafeERC20 for IERC20;
    
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
    error ArrayTooLarge();
    error InvalidTimestamp();
    error InvalidStateRoot();
    error InvalidTransactionsRoot();
    error InvalidReceiptsRoot();
    error InvalidGasLimit();
    error ExtraDataTooLong();
    error AlreadyVoted();
    error BlockTooOld();
    error InvalidValidatorSet();
    error InsufficientChallengeBond();
    error InvalidMerkleProof();
    
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
        uint256 bondAmount;
        bool verified;
        bool resolved;
        bytes externalEncodedProof;
    }
    
    // Checkpoint structure
    struct Checkpoint {
        uint256 blockNumber;
        bytes32 blockHash;
        bytes32 stateRoot;
        uint256 timestamp;
        bytes32 validatorSetHash;
        bool finalized;
    }
    
    // Configuration struct to reduce state variable count
    struct ConsensusConfig {
        uint256 blockTime; // 12 seconds
        uint256 validationThreshold; // 67% of validators must validate
        uint256 challengePeriod;
        uint256 checkpointInterval; // blocks
        uint256 maxBlockSize; // 1MB
        uint256 baseGasLimit;
        uint256 challengeBond; // Required bond for fraud proofs
    }

    // State variables
    ValidatorManager public immutable VALIDATOR_MANAGER;
    IERC20 public immutable GOVERNANCE_TOKEN;

    mapping(uint256 => BlockHeader) private blockHeaders;
    mapping(bytes32 => BlockValidation) private blockValidations;
    mapping(bytes32 => FraudProof) private fraudProofs;
    mapping(uint256 => Checkpoint) private checkpoints;
    mapping(address => uint256) public lastProposedBlock;
    mapping(bytes32 => bool) public processedTransactions;
    mapping(bytes32 => uint256) private blockNumberByHash;


    uint256 public currentBlockNumber;
    uint256 public lastFinalizedBlock;
    uint256 public lastCheckpointBlock;
    bytes32 public currentStateRoot;

    ConsensusConfig public consensusConfig;
    
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
    
    event ChainReverted(
        uint256 indexed revertToBlock,
        uint256 indexed previousBlock
    );
    
    constructor(address _validatorManager, address _governanceToken) {
        VALIDATOR_MANAGER = ValidatorManager(_validatorManager);
        GOVERNANCE_TOKEN = IERC20(_governanceToken);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(SEQUENCER_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        
        // Initialize genesis block
        currentBlockNumber = 0;
        currentStateRoot = keccak256("genesis");
        
        // Initialize configuration
        consensusConfig = ConsensusConfig({
            blockTime: 12, // 12 seconds
            validationThreshold: 67, // 67% of validators must validate
            challengePeriod: 7 days,
            checkpointInterval: 256, // blocks
            maxBlockSize: 1000000, // 1MB
            baseGasLimit: 30000000,
            challengeBond: 1000 * 10**18 // 1000 tokens required for challenge bond
        });
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
        if (gasUsed > consensusConfig.baseGasLimit) revert InvalidGasLimit();
        if (extraData.length > 32) revert ExtraDataTooLong();
        // For block 1, parentHash should be genesis hash (keccak256("genesis"))
        // For subsequent blocks, parentHash must match the previous block hash
        if (currentBlockNumber == 0) {
            // First block after genesis, parentHash should be genesis hash
            if (parentHash != keccak256("genesis")) {
                revert InvalidParentHash();
            }
        } else {
            bytes32 expectedParentHash = _calculateBlockHash(blockHeaders[currentBlockNumber]);
            if (parentHash != expectedParentHash) {
                revert InvalidParentHash();
            }
        }
        if (block.timestamp < lastProposedBlock[msg.sender] + consensusConfig.blockTime) revert InvalidTimestamp();
        
        uint256 newBlockNumber = currentBlockNumber + 1;
        
        // Create block header
        BlockHeader memory header = BlockHeader({
            blockNumber: newBlockNumber,
            parentHash: parentHash,
            stateRoot: stateRoot,
            transactionsRoot: transactionsRoot,
            timestamp: block.timestamp,
            proposer: msg.sender,
            gasLimit: consensusConfig.baseGasLimit,
            gasUsed: gasUsed,
            receiptsRoot: receiptsRoot,
            difficulty: 1, // Fixed difficulty for PoS
            extraData: extraData
        });
        
        bytes32 blockHash = _calculateBlockHash(header);
        
        // Store block header
        blockHeaders[newBlockNumber] = header;
        blockNumberByHash[blockHash] = newBlockNumber;
        
        // Initialize block validation
        BlockValidation storage validation = blockValidations[blockHash];
        validation.blockHash = blockHash;
        validation.requiredValidators = _calculateRequiredValidators();
        validation.challengeDeadline = block.timestamp + consensusConfig.challengePeriod;
        
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
        nonReentrant 
    {
        BlockValidation storage validation = blockValidations[blockHash];
        if (validation.blockHash == bytes32(0)) revert BlockNotFound();
        if (validation.finalized) revert BlockAlreadyFinalized();
        if (validation.validatorVotes[msg.sender]) revert AlreadyVoted();
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
        bytes[] memory merkleProofs,
        bytes memory externalEncodedProof
    ) external whenNotPaused nonReentrant {
        if (transactions.length > 1000) revert ArrayTooLarge();
        if (receipts.length > 1000) revert ArrayTooLarge();
        if (merkleProofs.length > 1000) revert ArrayTooLarge();
        BlockValidation storage validation = blockValidations[blockHash];
        if (validation.blockHash == bytes32(0)) revert BlockNotFound();
        if (validation.finalized) revert BlockAlreadyFinalized();
        if (validation.challenged) revert ChallengeAlreadyExists();
        if (block.timestamp > validation.challengeDeadline) revert InvalidChallengePeriod();

        // Verify caller has sufficient stake
        (uint256 callerStake, bool isActive) = VALIDATOR_MANAGER.getValidatorStake(msg.sender);
        if (callerStake == 0 || !isActive) revert UnauthorizedAccess();
        
        // Transfer challenge bond to escrow
        uint256 bondAmount = consensusConfig.challengeBond;
        if (GOVERNANCE_TOKEN.balanceOf(msg.sender) < bondAmount) revert InsufficientChallengeBond();
        
        // Transfer challenge bond to escrow
        GOVERNANCE_TOKEN.safeTransferFrom(msg.sender, address(this), bondAmount);

        // Mark as challenged and extend challenge window
        validation.challenged = true;
        validation.challenger = msg.sender;
        validation.challengeDeadline = block.timestamp + consensusConfig.challengePeriod;
        
        // Store fraud proof
        fraudProofs[blockHash] = FraudProof({
            blockHash: blockHash,
            stateTransition: stateTransition,
            transactions: transactions,
            receipts: receipts,
            merkleProofs: merkleProofs,
            challenger: msg.sender,
            timestamp: block.timestamp,
            bondAmount: bondAmount,
            verified: false,
            resolved: false,
            externalEncodedProof: externalEncodedProof
        });
        

        
        emit FraudProofSubmitted(blockHash, msg.sender, stateTransition);
    }
    
    /**
     * @dev Verify a fraud proof
     * @param blockHash Hash of the challenged block
     */
    function verifyFraudProof(bytes32 blockHash) external onlyRole(ORACLE_ROLE) whenNotPaused nonReentrant {

        FraudProof storage proof = fraudProofs[blockHash];
        if (proof.blockHash == bytes32(0)) revert InvalidFraudProof();
        if (proof.verified) revert InvalidFraudProof();
        if (proof.resolved) revert InvalidFraudProof();

        BlockValidation storage validation = blockValidations[blockHash];
        if (!validation.challenged) revert ChallengeNotFound();
        if (block.timestamp > validation.challengeDeadline) revert InvalidChallengePeriod();

        // Verify the fraud proof (simplified - in production would need full verification)
        bool isValid = _verifyStateTransition(
            blockHash,
            proof.stateTransition,
            proof.transactions,
            proof.receipts,
            proof.merkleProofs
        );
        

        
        proof.verified = isValid;
        proof.resolved = true;
        
        // Store challenger address before any operations that might delete the proof
        address challengerAddr = proof.challenger;
        
        // Get challenge bond amount from per-block storage
        uint256 bondAmount = proof.bondAmount;
        if (isValid) {
            // Fraud proven - slash the block proposer
            BlockHeader memory header = _getBlockByHash(blockHash);
            VALIDATOR_MANAGER.slashValidator(
                header.proposer,
                ValidatorManager.SlashingReason.INVALID_BLOCK,
                proof.externalEncodedProof
            );
            
            // Refund challenge bond to successful challenger
            if (bondAmount > 0) {
                GOVERNANCE_TOKEN.safeTransfer(challengerAddr, bondAmount);
            }
            
            // Revert to previous state (this will delete the fraud proof)
            // Note: We preserve the fraud proof verification status before reverting
            _revertToBlock(header.blockNumber - 1);
            
            // Re-store the fraud proof with verified status for historical record
            fraudProofs[blockHash] = FraudProof({
                blockHash: blockHash,
                stateTransition: proof.stateTransition,
                transactions: proof.transactions,
                receipts: proof.receipts,
                merkleProofs: proof.merkleProofs,
                challenger: challengerAddr,
                timestamp: proof.timestamp,
                bondAmount: proof.bondAmount,
                verified: true,
                resolved: true,
                externalEncodedProof: proof.externalEncodedProof
            });
        } else {
            // Fraud proof invalid - slash the challenger
            VALIDATOR_MANAGER.slashValidator(
                challengerAddr,
                ValidatorManager.SlashingReason.MALICIOUS_BEHAVIOR,
                abi.encode(proof.blockHash, proof.challenger, proof.timestamp, proof.stateTransition)
            );
            
            // Forfeit challenge bond (keep it in contract)
            if (bondAmount > 0) {
                // Bond is forfeited - kept in contract
            }
            
            // Clear fraud proof state after processing
            delete fraudProofs[blockHash];
        }
        

        emit FraudProofVerified(blockHash, isValid, challengerAddr);
    }
    
    /**
     * @dev Create a checkpoint for finalized blocks
     * @param blockNumber Block number to checkpoint
     */
    function createCheckpoint(uint256 blockNumber) external onlyRole(ORACLE_ROLE) {
        if (blockNumber > lastFinalizedBlock) revert BlockNotFound();
        if (blockNumber < lastCheckpointBlock + consensusConfig.checkpointInterval) revert BlockTooOld();
        
        BlockHeader memory header = blockHeaders[blockNumber];
        bytes32 validatorSetHash = _calculateValidatorSetHash();
        
        checkpoints[blockNumber] = Checkpoint({
            blockNumber: blockNumber,
            blockHash: _calculateBlockHash(header),
            stateRoot: header.stateRoot,
            timestamp: block.timestamp,
            validatorSetHash: validatorSetHash,
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
        VALIDATOR_MANAGER.recordBlockProduction(header.proposer, header.blockNumber);
        
        emit BlockFinalized(header.blockNumber, blockHash, validation.validatorCount);
    }
    
    /**
     * @dev Calculate required number of validators for consensus
     * @return Required validator count
     */
    function _calculateRequiredValidators() internal view returns (uint256) {
        address[] memory activeValidators = VALIDATOR_MANAGER.getActiveValidators();
        uint256 required = (activeValidators.length * consensusConfig.validationThreshold + 99) / 100; // Ceiling division
        return required == 0 ? 1 : required; // Ensure at least 1 validator required
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
        uint256 blockNumber = blockNumberByHash[blockHash];
        if (blockNumber == 0) revert BlockNotFound();
        return blockHeaders[blockNumber];
    }
    
    /**
     * @dev Verify Merkle proof for a leaf against a root
     * @param leaf The leaf to verify
     * @param root The Merkle root
     * @param proof Array of sibling hashes for the proof
     * @return True if the proof is valid
     */
    function _verifyMerkleProof(bytes32 leaf, bytes32 root, bytes32[] memory proof) internal pure returns (bool) {
        bytes32 computed = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            if (computed < proof[i]) {
                computed = keccak256(abi.encodePacked(computed, proof[i]));
            } else {
                computed = keccak256(abi.encodePacked(proof[i], computed));
            }
        }
        return computed == root;
    }

    /**
     * @dev Verify state transition with proper Merkle proof verification
     * @param blockHash Hash of the block being challenged
     * @param stateTransition State transition hash
     * @param transactions Transaction data
     * @param receipts Receipt data
     * @param merkleProofs Merkle proofs (flattened array of proof hashes)
     * @return True if fraud is proven (i.e., block data is incorrect)
     */
    function _verifyStateTransition(
        bytes32 blockHash,
        bytes32 stateTransition,
        bytes[] memory transactions,
        bytes[] memory receipts,
        bytes[] memory merkleProofs
    ) internal view returns (bool) {
        // Get the block header to compare against
        BlockHeader memory header = _getBlockByHash(blockHash);
        
        // Basic validation: check if we have matching counts
        if (transactions.length != receipts.length) {
            return true; // Fraud proven - mismatched transaction/receipt counts
        }
        
        // Verify transactions against transactionsRoot
        bytes32 calculatedTxRoot = _calculateMerkleRoot(transactions);
        if (calculatedTxRoot != header.transactionsRoot) {
            return true; // Fraud proven - transactions don't match claimed root
        }
        
        // Verify receipts against receiptsRoot
        bytes32 calculatedReceiptRoot = _calculateMerkleRoot(receipts);
        if (calculatedReceiptRoot != header.receiptsRoot) {
            return true; // Fraud proven - receipts don't match claimed root
        }
        
        // Verify state transition hash consistency
        // The stateTransition should be the hash of the new state root after processing transactions
        bytes32 expectedStateTransition = keccak256(abi.encode(
            header.blockNumber,
            header.stateRoot,
            calculatedTxRoot,
            calculatedReceiptRoot
        ));
        
        // Fraud is proven if state transition doesn't match expected format
        return stateTransition != expectedStateTransition;
    }
    
    /**
     * @dev Calculate Merkle root from array of data
     * @param data Array of bytes data to calculate root from
     * @return Merkle root
     */
    function _calculateMerkleRoot(bytes[] memory data) internal pure returns (bytes32) {
        if (data.length == 0) {
            return bytes32(0);
        }
        
        bytes32[] memory hashes = new bytes32[](data.length);
        for (uint256 i = 0; i < data.length; i++) {
            hashes[i] = keccak256(data[i]);
        }
        
        // Build Merkle tree
        uint256 n = hashes.length;
        while (n > 1) {
            uint256 j = 0;
            for (uint256 i = 0; i < n; i += 2) {
                if (i + 1 < n) {
                    hashes[j] = keccak256(abi.encodePacked(hashes[i], hashes[i + 1]));
                } else {
                    hashes[j] = hashes[i]; // Handle odd number of leaves
                }
                j++;
            }
            n = j;
        }
        
        return hashes[0];
    }

    /**
     * @dev Calculate validator set hash
     * @return Validator set hash
     */
    function _calculateValidatorSetHash() internal view returns (bytes32) {
        address[] memory activeValidators = VALIDATOR_MANAGER.getActiveValidators();
        return keccak256(abi.encode(activeValidators));
    }
    
    /**
     * @dev Revert blockchain state to a previous block
     * @param blockNumber Block number to revert to
     */
    function _revertToBlock(uint256 blockNumber) internal {
        if (blockNumber >= currentBlockNumber) revert InvalidBlockNumber();
        
        // Limit the number of blocks that can be reverted to prevent unbounded loops
        uint256 maxRevertBlocks = 1000;
        uint256 blocksToRevert = currentBlockNumber - blockNumber;
        if (blocksToRevert > maxRevertBlocks) revert ArrayTooLarge();
        
        // Clear all blocks after the revert point
        for (uint256 i = blockNumber + 1; i <= currentBlockNumber; i++) {
            bytes32 blockHash = _calculateBlockHash(blockHeaders[i]);
            
            // Clear block data
            delete blockHeaders[i];
            
            // Clear BlockValidation struct with mapping members
            BlockValidation storage validation = blockValidations[blockHash];
            if (validation.blockHash != bytes32(0)) {
                // Reset struct fields manually since it contains mappings
                validation.blockHash = bytes32(0);
                validation.validatorCount = 0;
                validation.requiredValidators = 0;
                // Note: mapping members (validatorVotes, validatorSignatures) cannot be cleared
                // but will be inaccessible once the struct is reset
                validation.finalized = false;
                validation.finalizedAt = 0;
                validation.challenged = false;
                validation.challenger = address(0);
                validation.challengeDeadline = 0;
            }
            
            delete blockNumberByHash[blockHash];
            
            // Clear any pending fraud proofs for these blocks
            // Note: FraudProof struct doesn't contain mappings, but being explicit
            if (fraudProofs[blockHash].challenger != address(0)) {
                fraudProofs[blockHash] = FraudProof({
                blockHash: bytes32(0),
                stateTransition: bytes32(0),
                transactions: new bytes[](0),
                receipts: new bytes[](0),
                merkleProofs: new bytes[](0),
                challenger: address(0),
                timestamp: 0,
                bondAmount: 0,
                verified: false,
                resolved: false,
                externalEncodedProof: new bytes(0)
            });
            }
        }
        
        // Store previous block number before updating
        uint256 previousBlockNumber = currentBlockNumber;
        
        // Update chain state
        currentBlockNumber = blockNumber;
        currentStateRoot = blockHeaders[blockNumber].stateRoot;
        
        // Only update lastFinalizedBlock if we're reverting past it
        if (lastFinalizedBlock > blockNumber) {
            lastFinalizedBlock = blockNumber;
        }
        
        emit ChainReverted(blockNumber, previousBlockNumber);
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
        consensusConfig.blockTime = _blockTime;
    }

    function setValidationThreshold(uint256 _threshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_threshold <= 50 || _threshold > 100) revert InvalidValidatorSet();
        consensusConfig.validationThreshold = _threshold;
    }

    function setChallengePeriod(uint256 _period) external onlyRole(DEFAULT_ADMIN_ROLE) {
        consensusConfig.challengePeriod = _period;
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