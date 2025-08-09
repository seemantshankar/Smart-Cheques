// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title StateRootManager
 * @dev Manages state root submissions and challenges for the L2 rollup
 * @notice This contract handles the core consensus mechanism for state transitions
 */
contract StateRootManager is 
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant SEQUENCER_ROLE = keccak256("SEQUENCER_ROLE");
    bytes32 public constant CHALLENGER_ROLE = keccak256("CHALLENGER_ROLE");

    /// @dev Challenge period duration (7 days)
    uint256 public constant CHALLENGE_PERIOD = 7 days;
    
    /// @dev Minimum bond required to submit a state root
    uint256 public constant SEQUENCER_BOND = 100 ether;
    
    /// @dev Minimum bond required to challenge a state root
    uint256 public constant CHALLENGER_BOND = 10 ether;

    struct StateRoot {
        bytes32 root;              // The state root hash
        uint256 blockNumber;       // L2 block number
        uint256 l1BlockNumber;     // L1 block number when submitted
        uint256 timestamp;         // Submission timestamp
        address proposer;          // Address that proposed this root
        bool challenged;           // Whether this root has been challenged
        bool finalized;            // Whether this root is finalized
        uint256 challengeDeadline; // Deadline for challenges
        bytes32 parentRoot;        // Previous state root
        uint256 transactionCount;  // Number of transactions in this batch
    }

    struct Challenge {
        address challenger;        // Address that submitted the challenge
        bytes32 stateRoot;        // The challenged state root
        bytes fraudProof;         // Fraud proof data
        bool resolved;            // Whether challenge is resolved
        bool successful;          // Whether challenge was successful
        uint256 timestamp;        // Challenge submission timestamp
        uint256 bond;             // Bond amount locked by challenger
    }

    /// @dev Mapping from state root hash to StateRoot struct
    mapping(bytes32 => StateRoot) public stateRoots;
    
    /// @dev Mapping from challenge ID to Challenge struct
    mapping(uint256 => Challenge) public challenges;
    
    /// @dev Array of all state root hashes in order
    bytes32[] public stateRootHistory;
    
    /// @dev Current latest finalized state root
    bytes32 public latestFinalizedRoot;
    
    /// @dev Current latest proposed state root
    bytes32 public latestProposedRoot;
    
    /// @dev Challenge counter for unique IDs
    uint256 public challengeCounter;
    
    /// @dev Mapping to track sequencer bonds
    mapping(address => uint256) public sequencerBonds;
    
    /// @dev Mapping to track challenger bonds
    mapping(address => uint256) public challengerBonds;

    // Custom errors
    error InvalidStateRoot();
    error InvalidBlockNumber();
    error InvalidTransactionCount();
    error InsufficientBond();
    error InvalidParentRoot();
    error ParentRootNotFinalized();
    error StateRootAlreadyExists();
    error StateRootDoesNotExist();
    error AlreadyChallenged();
    error AlreadyFinalized();
    error ChallengePeriodExpired();
    error InvalidFraudProof();
    error ChallengeAlreadyResolved();
    error InvalidChallenge();
    error ChallengePeriodNotExpired();
    error UnresolvedChallenges();
    error TransferFailed();
    error EmergencyWithdrawalFailed();

    // Events
    event StateRootSubmitted(
        bytes32 indexed stateRoot,
        uint256 indexed blockNumber,
        address indexed proposer,
        uint256 timestamp,
        uint256 transactionCount
    );

    event StateRootChallenged(
        bytes32 indexed stateRoot,
        uint256 indexed challengeId,
        address indexed challenger,
        uint256 timestamp
    );

    event StateRootFinalized(
        bytes32 indexed stateRoot,
        uint256 indexed blockNumber,
        uint256 timestamp
    );

    event ChallengeResolved(
        uint256 indexed challengeId,
        bytes32 indexed stateRoot,
        bool successful,
        address challenger
    );

    event BondDeposited(address indexed account, uint256 amount, string bondType);
    event BondWithdrawn(address indexed account, uint256 amount, string bondType);
    event BondSlashed(address indexed account, uint256 amount, string reason);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() public {
        _disableInitializers();
    }

    /**
     * @dev Initialize the contract
     * @param admin Address to grant admin role
     */
    function initialize(address admin) public initializer {
        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
    }

    /**
     * @dev Submit a new state root
     * @param stateRoot The state root hash
     * @param blockNumber The L2 block number
     * @param parentRoot The previous state root
     * @param transactionCount Number of transactions in this batch
     */
    function submitStateRoot(
        bytes32 stateRoot,
        uint256 blockNumber,
        bytes32 parentRoot,
        uint256 transactionCount
    ) external payable onlyRole(SEQUENCER_ROLE) whenNotPaused nonReentrant {
        if (stateRoot == bytes32(0)) revert InvalidStateRoot();
        if (blockNumber == 0) revert InvalidBlockNumber();
        if (transactionCount == 0) revert InvalidTransactionCount();
        if (msg.value < SEQUENCER_BOND) revert InsufficientBond();
        
        // Verify parent root exists (except for genesis)
        if (blockNumber > 1) {
            if (stateRoots[parentRoot].root == bytes32(0)) revert InvalidParentRoot();
            if (!stateRoots[parentRoot].finalized) revert ParentRootNotFinalized();
        }

        // Ensure state root doesn't already exist
        if (stateRoots[stateRoot].root != bytes32(0)) revert StateRootAlreadyExists();

        uint256 challengeDeadline = block.timestamp + CHALLENGE_PERIOD;

        stateRoots[stateRoot] = StateRoot({
            root: stateRoot,
            blockNumber: blockNumber,
            l1BlockNumber: block.number,
            timestamp: block.timestamp,
            proposer: msg.sender,
            challenged: false,
            finalized: false,
            challengeDeadline: challengeDeadline,
            parentRoot: parentRoot,
            transactionCount: transactionCount
        });

        stateRootHistory.push(stateRoot);
        latestProposedRoot = stateRoot;
        
        // Lock sequencer bond
        sequencerBonds[msg.sender] += msg.value;

        emit StateRootSubmitted(
            stateRoot,
            blockNumber,
            msg.sender,
            block.timestamp,
            transactionCount
        );
        
        emit BondDeposited(msg.sender, msg.value, "sequencer");
    }

    /**
     * @dev Challenge a submitted state root
     * @param stateRoot The state root to challenge
     * @param fraudProof The fraud proof data
     */
    function challengeStateRoot(
        bytes32 stateRoot,
        bytes calldata fraudProof
    ) external payable whenNotPaused nonReentrant {
        if (msg.value < CHALLENGER_BOND) revert InsufficientBond();
        if (stateRoots[stateRoot].root == bytes32(0)) revert StateRootDoesNotExist();
        if (stateRoots[stateRoot].challenged) revert AlreadyChallenged();
        if (stateRoots[stateRoot].finalized) revert AlreadyFinalized();
        if (block.timestamp > stateRoots[stateRoot].challengeDeadline) revert ChallengePeriodExpired();
        if (fraudProof.length == 0) revert InvalidFraudProof();

        uint256 challengeId = challengeCounter++;
        
        challenges[challengeId] = Challenge({
            challenger: msg.sender,
            stateRoot: stateRoot,
            fraudProof: fraudProof,
            resolved: false,
            successful: false,
            timestamp: block.timestamp,
            bond: msg.value
        });

        stateRoots[stateRoot].challenged = true;
        challengerBonds[msg.sender] += msg.value;

        emit StateRootChallenged(stateRoot, challengeId, msg.sender, block.timestamp);
        emit BondDeposited(msg.sender, msg.value, "challenger");
    }

    /**
     * @dev Finalize a state root after challenge period
     * @param stateRoot The state root to finalize
     */
    function finalizeStateRoot(bytes32 stateRoot) external whenNotPaused nonReentrant {
        StateRoot storage root = stateRoots[stateRoot];
        
        if (root.root == bytes32(0)) revert StateRootDoesNotExist();
        if (root.finalized) revert AlreadyFinalized();
        if (root.challenged && !_allChallengesResolved(stateRoot)) revert UnresolvedChallenges();
        if (block.timestamp <= root.challengeDeadline) revert ChallengePeriodNotExpired();

        root.finalized = true;
        latestFinalizedRoot = stateRoot;

        // Release sequencer bond
        address proposer = root.proposer;
        uint256 bondAmount = SEQUENCER_BOND;
        sequencerBonds[proposer] -= bondAmount;
        
        (bool success, ) = proposer.call{value: bondAmount}("");
        if (!success) revert TransferFailed();

        emit StateRootFinalized(stateRoot, root.blockNumber, block.timestamp);
        emit BondWithdrawn(proposer, bondAmount, "sequencer");
    }

    /**
     * @dev Resolve a challenge (admin function)
     * @param challengeId The challenge ID to resolve
     * @param successful Whether the challenge was successful
     */
    function resolveChallenge(
        uint256 challengeId,
        bool successful
    ) external onlyRole(ADMIN_ROLE) whenNotPaused nonReentrant {
        Challenge storage challenge = challenges[challengeId];
        
        if (challenge.resolved) revert ChallengeAlreadyResolved();
        if (challenge.challenger == address(0)) revert InvalidChallenge();

        challenge.resolved = true;
        challenge.successful = successful;

        address challenger = challenge.challenger;
        uint256 challengerBond = challenge.bond;
        address proposer = stateRoots[challenge.stateRoot].proposer;

        if (successful) {
            // Challenge successful - slash sequencer, reward challenger
            uint256 sequencerBond = SEQUENCER_BOND;
            sequencerBonds[proposer] -= sequencerBond;
            challengerBonds[challenger] -= challengerBond;
            
            // Transfer bonds to challenger
            uint256 totalReward = sequencerBond + challengerBond;
            (bool success, ) = challenger.call{value: totalReward}("");
            if (!success) revert TransferFailed();
            
            emit BondSlashed(proposer, sequencerBond, "successful challenge");
            emit BondWithdrawn(challenger, totalReward, "challenge reward");
        } else {
            // Challenge unsuccessful - slash challenger
            challengerBonds[challenger] -= challengerBond;
            sequencerBonds[proposer] -= SEQUENCER_BOND;
            
            // Return sequencer bond, forfeit challenger bond
            (bool success, ) = proposer.call{value: SEQUENCER_BOND}("");
            if (!success) revert TransferFailed();
            
            emit BondSlashed(challenger, challengerBond, "unsuccessful challenge");
            emit BondWithdrawn(proposer, SEQUENCER_BOND, "sequencer");
        }

        emit ChallengeResolved(challengeId, challenge.stateRoot, successful, challenger);
    }

    /**
     * @dev Get state root information
     * @param stateRoot The state root hash
     * @return StateRoot struct
     */
    function getStateRoot(bytes32 stateRoot) external view returns (StateRoot memory) {
        return stateRoots[stateRoot];
    }

    /**
     * @dev Get challenge information
     * @param challengeId The challenge ID
     * @return Challenge struct
     */
    function getChallenge(uint256 challengeId) external view returns (Challenge memory) {
        return challenges[challengeId];
    }

    /**
     * @dev Get the number of state roots submitted
     * @return Number of state roots
     */
    function getStateRootCount() external view returns (uint256) {
        return stateRootHistory.length;
    }

    /**
     * @dev Check if all challenges for a state root are resolved
     * @return True if all challenges are resolved
     */
    function _allChallengesResolved(bytes32 /* stateRoot */) internal view returns (bool) {
        // This is a simplified implementation
        // In practice, you'd track challenges per state root
        return true;
    }

    /**
     * @dev Pause the contract (admin only)
     */
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    /**
     * @dev Unpause the contract (admin only)
     */
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    /**
     * @dev Authorize contract upgrades
     * @param newImplementation Address of the new implementation
     */
    // solhint-disable-next-line no-empty-blocks
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(ADMIN_ROLE) {
    }

    /**
     * @dev Emergency withdrawal function (admin only)
     */
    function emergencyWithdraw() external onlyRole(ADMIN_ROLE) {
        uint256 balance = address(this).balance;
        (bool success, ) = msg.sender.call{value: balance}("");
        if (!success) revert EmergencyWithdrawalFailed();
    }

    /**
     * @dev Receive function to accept ETH deposits
     */
    // solhint-disable-next-line no-empty-blocks
    receive() external payable {
        // Allow contract to receive ETH for bonds
    }
}