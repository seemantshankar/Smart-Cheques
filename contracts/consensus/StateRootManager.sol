// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

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
    constructor() {
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
        require(stateRoot != bytes32(0), "Invalid state root");
        require(blockNumber > 0, "Invalid block number");
        require(transactionCount > 0, "Invalid transaction count");
        require(msg.value >= SEQUENCER_BOND, "Insufficient bond");
        
        // Verify parent root exists (except for genesis)
        if (blockNumber > 1) {
            require(stateRoots[parentRoot].root != bytes32(0), "Invalid parent root");
            require(stateRoots[parentRoot].finalized, "Parent root not finalized");
        }

        // Ensure state root doesn't already exist
        require(stateRoots[stateRoot].root == bytes32(0), "State root already exists");

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
        require(msg.value >= CHALLENGER_BOND, "Insufficient challenger bond");
        require(stateRoots[stateRoot].root != bytes32(0), "State root does not exist");
        require(!stateRoots[stateRoot].challenged, "Already challenged");
        require(!stateRoots[stateRoot].finalized, "Already finalized");
        require(block.timestamp <= stateRoots[stateRoot].challengeDeadline, "Challenge period expired");
        require(fraudProof.length > 0, "Invalid fraud proof");

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
    function finalizeStateRoot(bytes32 stateRoot) external whenNotPaused {
        StateRoot storage root = stateRoots[stateRoot];
        
        require(root.root != bytes32(0), "State root does not exist");
        require(!root.finalized, "Already finalized");
        require(!root.challenged || _allChallengesResolved(stateRoot), "Unresolved challenges");
        require(block.timestamp > root.challengeDeadline, "Challenge period not expired");

        root.finalized = true;
        latestFinalizedRoot = stateRoot;

        // Release sequencer bond
        address proposer = root.proposer;
        uint256 bondAmount = SEQUENCER_BOND;
        sequencerBonds[proposer] -= bondAmount;
        
        (bool success, ) = proposer.call{value: bondAmount}("");
        require(success, "Bond transfer failed");

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
    ) external onlyRole(ADMIN_ROLE) whenNotPaused {
        Challenge storage challenge = challenges[challengeId];
        
        require(!challenge.resolved, "Challenge already resolved");
        require(challenge.challenger != address(0), "Invalid challenge");

        challenge.resolved = true;
        challenge.successful = successful;

        bytes32 stateRoot = challenge.stateRoot;
        address challenger = challenge.challenger;
        uint256 challengerBond = challenge.bond;
        address proposer = stateRoots[stateRoot].proposer;

        if (successful) {
            // Challenge successful - slash sequencer, reward challenger
            uint256 sequencerBond = SEQUENCER_BOND;
            sequencerBonds[proposer] -= sequencerBond;
            challengerBonds[challenger] -= challengerBond;
            
            // Transfer bonds to challenger
            uint256 totalReward = sequencerBond + challengerBond;
            (bool success, ) = challenger.call{value: totalReward}("");
            require(success, "Reward transfer failed");
            
            emit BondSlashed(proposer, sequencerBond, "successful challenge");
            emit BondWithdrawn(challenger, totalReward, "challenge reward");
        } else {
            // Challenge unsuccessful - slash challenger
            challengerBonds[challenger] -= challengerBond;
            sequencerBonds[proposer] -= SEQUENCER_BOND;
            
            // Return sequencer bond, forfeit challenger bond
            (bool success, ) = proposer.call{value: SEQUENCER_BOND}("");
            require(success, "Bond return failed");
            
            emit BondSlashed(challenger, challengerBond, "unsuccessful challenge");
            emit BondWithdrawn(proposer, SEQUENCER_BOND, "sequencer");
        }

        emit ChallengeResolved(challengeId, stateRoot, successful, challenger);
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
     * @param stateRoot The state root to check
     * @return True if all challenges are resolved
     */
    function _allChallengesResolved(bytes32 stateRoot) internal view returns (bool) {
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
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(ADMIN_ROLE) {}

    /**
     * @dev Emergency withdrawal function (admin only)
     */
    function emergencyWithdraw() external onlyRole(ADMIN_ROLE) {
        uint256 balance = address(this).balance;
        (bool success, ) = msg.sender.call{value: balance}("");
        require(success, "Emergency withdrawal failed");
    }

    /**
     * @dev Receive function to accept ETH deposits
     */
    receive() external payable {
        // Allow contract to receive ETH for bonds
    }
}