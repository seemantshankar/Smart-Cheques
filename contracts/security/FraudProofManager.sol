// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title FraudProofManager
 * @dev Manages fraud proofs for optimistic rollup consensus
 * Handles challenge submission, verification, and resolution
 */
contract FraudProofManager is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant CHALLENGER_ROLE = keccak256("CHALLENGER_ROLE");
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant SEQUENCER_ROLE = keccak256("SEQUENCER_ROLE");

    // Challenge types
    enum ChallengeType {
        INVALID_STATE_TRANSITION,
        INVALID_TRANSACTION,
        INVALID_BLOCK_HEADER,
        INVALID_MERKLE_ROOT,
        DOUBLE_SPENDING,
        UNAUTHORIZED_WITHDRAWAL
    }

    // Challenge status
    enum ChallengeStatus {
        PENDING,
        VERIFIED,
        REJECTED,
        RESOLVED,
        EXPIRED
    }

    // Fraud proof structure
    struct FraudProof {
        uint256 challengeId;
        address challenger;
        address accused;
        ChallengeType challengeType;
        uint256 blockNumber;
        bytes32 stateRoot;
        bytes32 transactionHash;
        bytes proofData;
        uint256 bondAmount;
        uint256 timestamp;
        uint256 deadline;
        ChallengeStatus status;
        address resolver;
        string description;
    }

    // State transition proof
    struct StateTransitionProof {
        bytes32 preStateRoot;
        bytes32 postStateRoot;
        bytes32[] merkleProof;
        bytes transactionData;
        uint256 gasUsed;
        bytes executionTrace;
    }

    // Transaction inclusion proof
    struct TransactionInclusionProof {
        bytes32 transactionHash;
        bytes32 blockHash;
        bytes32[] merkleProof;
        uint256 transactionIndex;
        bytes transactionData;
    }

    // Withdrawal proof
    struct WithdrawalProof {
        address recipient;
        uint256 amount;
        bytes32 withdrawalHash;
        bytes32[] merkleProof;
        uint256 blockNumber;
        bool processed;
    }

    // State variables
    IERC20 public bondToken;
    address public stateRootManager;
    address public slashingManager;
    
    // Challenge parameters
    uint256 public challengeBond;
    uint256 public challengePeriod;
    uint256 public verificationPeriod;
    uint256 public maxChallengesPerBlock;
    
    // Challenge storage
    mapping(uint256 => FraudProof) public fraudProofs;
    mapping(bytes32 => uint256) public blockChallenges;
    mapping(address => uint256[]) public challengerHistory;
    mapping(address => uint256) public challengerBonds;
    uint256 public totalChallenges;
    
    // Block and state tracking
    mapping(uint256 => bytes32) public blockStateRoots;
    mapping(uint256 => uint256) public blockTimestamps;
    mapping(uint256 => bool) public finalizedBlocks;
    
    // Challenge statistics
    mapping(ChallengeType => uint256) public challengeTypeCounts;
    mapping(address => uint256) public successfulChallenges;
    mapping(address => uint256) public failedChallenges;
    
    // Verification game state
    struct VerificationGame {
        uint256 challengeId;
        address challenger;
        address defender;
        uint256 currentStep;
        uint256 totalSteps;
        bytes32[] stateHashes;
        bool completed;
        address winner;
    }
    
    mapping(uint256 => VerificationGame) public verificationGames;
    uint256 public totalGames;
    
    // Events
    event ChallengeSubmitted(
        uint256 indexed challengeId,
        address indexed challenger,
        address indexed accused,
        ChallengeType challengeType,
        uint256 blockNumber
    );
    
    event ChallengeVerified(
        uint256 indexed challengeId,
        address indexed verifier,
        bool valid,
        string reason
    );
    
    event ChallengeResolved(
        uint256 indexed challengeId,
        ChallengeStatus status,
        address indexed winner,
        uint256 bondDistribution
    );
    
    event VerificationGameStarted(
        uint256 indexed gameId,
        uint256 indexed challengeId,
        address indexed challenger,
        address defender
    );
    
    event VerificationGameCompleted(
        uint256 indexed gameId,
        address indexed winner,
        uint256 steps
    );
    
    event FraudProven(
        uint256 indexed challengeId,
        address indexed fraudster,
        uint256 slashedAmount
    );
    
    event BondSlashed(
        address indexed account,
        uint256 amount,
        string reason
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initialize the fraud proof manager
     * @param _bondToken Token used for challenge bonds
     * @param _stateRootManager Address of state root manager
     * @param _slashingManager Address of slashing manager
     * @param _challengeBond Required bond amount for challenges
     * @param _challengePeriod Time window for submitting challenges
     * @param _verificationPeriod Time window for verification
     */
    function initialize(
        address _bondToken,
        address _stateRootManager,
        address _slashingManager,
        uint256 _challengeBond,
        uint256 _challengePeriod,
        uint256 _verificationPeriod
    ) public initializer {
        require(_bondToken != address(0), "Invalid bond token");
        require(_stateRootManager != address(0), "Invalid state root manager");
        require(_slashingManager != address(0), "Invalid slashing manager");
        require(_challengeBond > 0, "Invalid challenge bond");
        require(_challengePeriod > 0, "Invalid challenge period");
        require(_verificationPeriod > 0, "Invalid verification period");

        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        bondToken = IERC20(_bondToken);
        stateRootManager = _stateRootManager;
        slashingManager = _slashingManager;
        challengeBond = _challengeBond;
        challengePeriod = _challengePeriod;
        verificationPeriod = _verificationPeriod;
        maxChallengesPerBlock = 10;

        // Set up roles
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(CHALLENGER_ROLE, msg.sender);
        _grantRole(VERIFIER_ROLE, msg.sender);
    }

    /**
     * @dev Submit a fraud proof challenge
     * @param accused Address of the accused party
     * @param challengeType Type of challenge
     * @param blockNumber Block number being challenged
     * @param stateRoot State root being challenged
     * @param transactionHash Transaction hash (if applicable)
     * @param proofData Proof data
     * @param description Human-readable description
     * @return challengeId The ID of the created challenge
     */
    function submitChallenge(
        address accused,
        ChallengeType challengeType,
        uint256 blockNumber,
        bytes32 stateRoot,
        bytes32 transactionHash,
        bytes calldata proofData,
        string memory description
    ) external onlyRole(CHALLENGER_ROLE) nonReentrant whenNotPaused returns (uint256) {
        require(accused != address(0), "Invalid accused address");
        require(blockNumber > 0, "Invalid block number");
        require(stateRoot != bytes32(0), "Invalid state root");
        require(proofData.length > 0, "Invalid proof data");
        require(!finalizedBlocks[blockNumber], "Block already finalized");
        
        // Check challenge period
        require(
            block.timestamp <= blockTimestamps[blockNumber] + challengePeriod,
            "Challenge period expired"
        );
        
        // Check maximum challenges per block
        require(
            blockChallenges[keccak256(abi.encodePacked(blockNumber))] < maxChallengesPerBlock,
            "Too many challenges for this block"
        );
        
        // Transfer challenge bond
        bondToken.safeTransferFrom(msg.sender, address(this), challengeBond);
        challengerBonds[msg.sender] += challengeBond;
        
        uint256 challengeId = totalChallenges++;
        uint256 deadline = block.timestamp + verificationPeriod;
        
        fraudProofs[challengeId] = FraudProof({
            challengeId: challengeId,
            challenger: msg.sender,
            accused: accused,
            challengeType: challengeType,
            blockNumber: blockNumber,
            stateRoot: stateRoot,
            transactionHash: transactionHash,
            proofData: proofData,
            bondAmount: challengeBond,
            timestamp: block.timestamp,
            deadline: deadline,
            status: ChallengeStatus.PENDING,
            resolver: address(0),
            description: description
        });
        
        challengerHistory[msg.sender].push(challengeId);
        blockChallenges[keccak256(abi.encodePacked(blockNumber))]++;
        challengeTypeCounts[challengeType]++;
        
        emit ChallengeSubmitted(
            challengeId,
            msg.sender,
            accused,
            challengeType,
            blockNumber
        );
        
        return challengeId;
    }

    /**
     * @dev Verify a fraud proof challenge
     * @param challengeId Challenge ID to verify
     * @param valid Whether the challenge is valid
     * @param reason Reason for the verification result
     */
    function verifyChallenge(
        uint256 challengeId,
        bool valid,
        string memory reason
    ) external onlyRole(VERIFIER_ROLE) {
        require(challengeId < totalChallenges, "Invalid challenge ID");
        FraudProof storage proof = fraudProofs[challengeId];
        require(proof.status == ChallengeStatus.PENDING, "Challenge not pending");
        require(block.timestamp <= proof.deadline, "Verification period expired");
        
        if (valid) {
            proof.status = ChallengeStatus.VERIFIED;
            // Start verification game if needed
            _startVerificationGame(challengeId);
        } else {
            proof.status = ChallengeStatus.REJECTED;
            // Return bond to challenger
            _returnBond(proof.challenger, proof.bondAmount);
            failedChallenges[proof.challenger]++;
        }
        
        proof.resolver = msg.sender;
        
        emit ChallengeVerified(challengeId, msg.sender, valid, reason);
    }

    /**
     * @dev Start a verification game for a verified challenge
     * @param challengeId Challenge ID
     */
    function _startVerificationGame(uint256 challengeId) internal {
        FraudProof storage proof = fraudProofs[challengeId];
        
        uint256 gameId = totalGames++;
        verificationGames[gameId] = VerificationGame({
            challengeId: challengeId,
            challenger: proof.challenger,
            defender: proof.accused,
            currentStep: 0,
            totalSteps: 0,
            stateHashes: new bytes32[](0),
            completed: false,
            winner: address(0)
        });
        
        emit VerificationGameStarted(
            gameId,
            challengeId,
            proof.challenger,
            proof.accused
        );
    }

    /**
     * @dev Resolve a challenge after verification
     * @param challengeId Challenge ID to resolve
     * @param winner Address of the winning party
     */
    function resolveChallenge(
        uint256 challengeId,
        address winner
    ) external onlyRole(VERIFIER_ROLE) {
        require(challengeId < totalChallenges, "Invalid challenge ID");
        FraudProof storage proof = fraudProofs[challengeId];
        require(proof.status == ChallengeStatus.VERIFIED, "Challenge not verified");
        require(winner == proof.challenger || winner == proof.accused, "Invalid winner");
        
        proof.status = ChallengeStatus.RESOLVED;
        
        if (winner == proof.challenger) {
            // Challenger wins - fraud proven
            successfulChallenges[proof.challenger]++;
            
            // Return bond to challenger and slash accused
            _returnBond(proof.challenger, proof.bondAmount);
            _slashFraudster(proof.accused, challengeId);
            
            emit FraudProven(challengeId, proof.accused, proof.bondAmount);
        } else {
            // Accused wins - challenge was invalid
            failedChallenges[proof.challenger]++;
            
            // Slash challenger's bond
            _slashBond(proof.challenger, proof.bondAmount, "Invalid challenge");
        }
        
        emit ChallengeResolved(
            challengeId,
            proof.status,
            winner,
            proof.bondAmount
        );
    }

    /**
     * @dev Verify state transition proof
     * @param proof State transition proof data
     * @return valid Whether the proof is valid
     */
    function verifyStateTransition(
        StateTransitionProof memory proof
    ) public pure returns (bool valid) {
        // Verify merkle proof for state transition
        bytes32 leaf = keccak256(abi.encodePacked(
            proof.preStateRoot,
            proof.postStateRoot,
            proof.transactionData,
            proof.gasUsed
        ));
        
        // This is a simplified verification - in practice, this would involve
        // more complex state transition validation
        return MerkleProof.verify(
            proof.merkleProof,
            proof.postStateRoot,
            leaf
        );
    }

    /**
     * @dev Verify transaction inclusion proof
     * @param proof Transaction inclusion proof data
     * @return valid Whether the proof is valid
     */
    function verifyTransactionInclusion(
        TransactionInclusionProof memory proof
    ) public pure returns (bool valid) {
        bytes32 leaf = keccak256(proof.transactionData);
        
        return MerkleProof.verify(
            proof.merkleProof,
            proof.blockHash,
            leaf
        );
    }

    /**
     * @dev Verify withdrawal proof
     * @param proof Withdrawal proof data
     * @return valid Whether the proof is valid
     */
    function verifyWithdrawal(
        WithdrawalProof memory proof
    ) public pure returns (bool valid) {
        bytes32 leaf = keccak256(abi.encodePacked(
            proof.recipient,
            proof.amount,
            proof.withdrawalHash,
            proof.blockNumber
        ));
        
        return MerkleProof.verify(
            proof.merkleProof,
            proof.withdrawalHash,
            leaf
        ) && !proof.processed;
    }

    /**
     * @dev Slash a fraudster's stake
     * @param fraudster Address of the fraudster
     * @param challengeId Challenge ID
     */
    function _slashFraudster(address fraudster, uint256 challengeId) internal {
        // This would interface with the slashing manager
        // For now, we'll emit an event
        emit FraudProven(challengeId, fraudster, challengeBond);
    }

    /**
     * @dev Slash a challenger's bond
     * @param challenger Address of the challenger
     * @param amount Amount to slash
     * @param reason Reason for slashing
     */
    function _slashBond(address challenger, uint256 amount, string memory reason) internal {
        require(challengerBonds[challenger] >= amount, "Insufficient bond");
        
        challengerBonds[challenger] -= amount;
        // Transfer slashed amount to treasury or burn
        
        emit BondSlashed(challenger, amount, reason);
    }

    /**
     * @dev Return bond to challenger
     * @param challenger Address of the challenger
     * @param amount Amount to return
     */
    function _returnBond(address challenger, uint256 amount) internal {
        require(challengerBonds[challenger] >= amount, "Insufficient bond");
        
        challengerBonds[challenger] -= amount;
        bondToken.safeTransfer(challenger, amount);
    }

    /**
     * @dev Expire old challenges
     * @param challengeId Challenge ID to expire
     */
    function expireChallenge(uint256 challengeId) external {
        require(challengeId < totalChallenges, "Invalid challenge ID");
        FraudProof storage proof = fraudProofs[challengeId];
        require(proof.status == ChallengeStatus.PENDING, "Challenge not pending");
        require(block.timestamp > proof.deadline, "Challenge not expired");
        
        proof.status = ChallengeStatus.EXPIRED;
        
        // Return bond to challenger
        _returnBond(proof.challenger, proof.bondAmount);
        
        emit ChallengeResolved(
            challengeId,
            ChallengeStatus.EXPIRED,
            address(0),
            0
        );
    }

    /**
     * @dev Get challenge details
     * @param challengeId Challenge ID
     * @return proof Fraud proof details
     */
    function getChallenge(uint256 challengeId) external view returns (FraudProof memory) {
        require(challengeId < totalChallenges, "Invalid challenge ID");
        return fraudProofs[challengeId];
    }

    /**
     * @dev Get challenger history
     * @param challenger Challenger address
     * @return challengeIds Array of challenge IDs
     */
    function getChallengerHistory(address challenger) external view returns (uint256[] memory) {
        return challengerHistory[challenger];
    }

    /**
     * @dev Get challenge statistics
     * @return totalCount Total number of challenges
     * @return typeCount Array of counts per challenge type
     * @return pendingCount Number of pending challenges
     */
    function getChallengeStatistics() external view returns (
        uint256 totalCount,
        uint256[6] memory typeCount,
        uint256 pendingCount
    ) {
        totalCount = totalChallenges;
        
        for (uint256 i = 0; i < 6; i++) {
            typeCount[i] = challengeTypeCounts[ChallengeType(i)];
        }
        
        // Count pending challenges
        for (uint256 i = 0; i < totalChallenges; i++) {
            if (fraudProofs[i].status == ChallengeStatus.PENDING) {
                pendingCount++;
            }
        }
    }

    /**
     * @dev Update challenge parameters
     * @param _challengeBond New challenge bond amount
     * @param _challengePeriod New challenge period
     * @param _verificationPeriod New verification period
     * @param _maxChallengesPerBlock New max challenges per block
     */
    function updateChallengeParameters(
        uint256 _challengeBond,
        uint256 _challengePeriod,
        uint256 _verificationPeriod,
        uint256 _maxChallengesPerBlock
    ) external onlyRole(ADMIN_ROLE) {
        require(_challengeBond > 0, "Invalid challenge bond");
        require(_challengePeriod > 0, "Invalid challenge period");
        require(_verificationPeriod > 0, "Invalid verification period");
        require(_maxChallengesPerBlock > 0, "Invalid max challenges");
        
        challengeBond = _challengeBond;
        challengePeriod = _challengePeriod;
        verificationPeriod = _verificationPeriod;
        maxChallengesPerBlock = _maxChallengesPerBlock;
    }

    /**
     * @dev Pause the contract
     */
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    /**
     * @dev Unpause the contract
     */
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    /**
     * @dev Authorize contract upgrade
     * @param newImplementation New implementation address
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(ADMIN_ROLE) {}
}