// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title SequencerManager
 * @dev Manages sequencer registration, staking, and rotation for the L2 network
 * @notice This contract handles sequencer lifecycle and block production rights
 */
contract SequencerManager is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    using Math for uint256;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant SLASHER_ROLE = keccak256("SLASHER_ROLE");

    /// @dev Minimum stake required to become a sequencer (100k tokens)
    uint256 public constant MIN_STAKE = 100000 ether;
    
    /// @dev Maximum time allowed between blocks (5 minutes)
    uint256 public constant BLOCK_TIMEOUT = 300;
    
    /// @dev Time period for sequencer rotation (1 hour)
    uint256 public constant ROTATION_PERIOD = 3600;
    
    /// @dev Maximum number of active sequencers
    uint256 public constant MAX_SEQUENCERS = 21;
    
    /// @dev Minimum uptime percentage required (95%)
    uint256 public constant MIN_UPTIME_PERCENTAGE = 9500; // 95.00%
    
    /// @dev Slashing percentage for downtime (1%)
    uint256 public constant DOWNTIME_SLASH_PERCENTAGE = 100; // 1.00%
    
    /// @dev Slashing percentage for double signing (50%)
    uint256 public constant DOUBLE_SIGN_SLASH_PERCENTAGE = 5000; // 50.00%

    enum SequencerStatus {
        Inactive,
        Active,
        Jailed,
        Exiting
    }

    struct Sequencer {
        address operator;           // Sequencer operator address
        address rewardAddress;      // Address to receive rewards
        uint256 stake;             // Total staked amount
        uint256 delegatedStake;    // Amount delegated by others
        uint256 commission;        // Commission rate (basis points)
        SequencerStatus status;    // Current status
        uint256 jailTime;          // Time when jailed (0 if not jailed)
        uint256 lastBlockTime;     // Timestamp of last block produced
        uint256 blocksProduced;    // Total blocks produced
        uint256 missedBlocks;      // Number of missed blocks
        uint256 registrationTime;  // When sequencer was registered
        uint256 exitTime;          // When exit was initiated (0 if not exiting)
        bytes publicKey;           // Public key for block signing
    }

    struct Delegation {
        uint256 amount;            // Delegated amount
        uint256 timestamp;         // Delegation timestamp
        uint256 withdrawTime;      // When withdrawal was initiated (0 if not withdrawing)
    }

    struct SequencerMetrics {
        uint256 totalBlocks;       // Total blocks assigned
        uint256 producedBlocks;    // Blocks actually produced
        uint256 uptimePercentage;  // Uptime percentage (basis points)
        uint256 lastUpdateTime;    // Last metrics update
    }

    /// @dev Mapping from sequencer address to Sequencer struct
    mapping(address => Sequencer) public sequencers;
    
    /// @dev Mapping from delegator to sequencer to delegation info
    mapping(address => mapping(address => Delegation)) public delegations;
    
    /// @dev Mapping from sequencer to metrics
    mapping(address => SequencerMetrics) public sequencerMetrics;
    
    /// @dev Array of active sequencer addresses
    address[] public activeSequencers;
    
    /// @dev Current sequencer index for round-robin
    uint256 public currentSequencerIndex;
    
    /// @dev Last rotation timestamp
    uint256 public lastRotationTime;
    
    /// @dev Total staked amount across all sequencers
    uint256 public totalStaked;
    
    /// @dev Minimum commission rate (1%)
    uint256 public minCommissionRate = 100;
    
    /// @dev Maximum commission rate (20%)
    uint256 public maxCommissionRate = 2000;
    
    /// @dev Jail duration (24 hours)
    uint256 public jailDuration = 86400;
    
    /// @dev Exit delay (7 days)
    uint256 public exitDelay = 604800;

    // Events
    event SequencerRegistered(
        address indexed sequencer,
        address indexed rewardAddress,
        uint256 stake,
        uint256 commission,
        bytes publicKey
    );

    event SequencerUpdated(
        address indexed sequencer,
        address newRewardAddress,
        uint256 newCommission
    );

    event SequencerJailed(
        address indexed sequencer,
        string reason,
        uint256 jailTime
    );

    event SequencerUnjailed(address indexed sequencer);

    event SequencerSlashed(
        address indexed sequencer,
        uint256 amount,
        string reason
    );

    event SequencerExitInitiated(
        address indexed sequencer,
        uint256 exitTime
    );

    event SequencerExited(address indexed sequencer, uint256 stake);

    event StakeDelegated(
        address indexed delegator,
        address indexed sequencer,
        uint256 amount
    );

    event StakeUndelegated(
        address indexed delegator,
        address indexed sequencer,
        uint256 amount
    );

    event SequencerRotated(
        address indexed oldSequencer,
        address indexed newSequencer,
        uint256 timestamp
    );

    event BlockProduced(
        address indexed sequencer,
        uint256 blockNumber,
        uint256 timestamp
    );

    event RewardsDistributed(
        address indexed sequencer,
        uint256 sequencerReward,
        uint256 delegatorReward
    );

    // Custom errors
    error InsufficientStake();
    error InvalidRewardAddress();
    error InvalidCommissionRate();
    error InvalidPublicKeyLength();
    error SequencerAlreadyRegistered();
    error MaxSequencersReached();
    error NotASequencer();
    error InvalidDelegationAmount();
    error SequencerNotFound();
    error SequencerNotActive();
    error InsufficientDelegation();
    error WithdrawalAlreadyInitiated();
    error NoWithdrawalInitiated();
    error WithdrawalDelayNotMet();
    error SequencerNotJailed();
    error JailPeriodNotCompleted();
    error TransferFailed();
    error InvalidPercentage();
    error RotationPeriodNotMet();
    error NoActiveSequencers();
    error InvalidImplementation();

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
        _grantRole(SLASHER_ROLE, admin);
        
        lastRotationTime = block.timestamp;
    }

    /**
     * @dev Register as a sequencer
     * @param rewardAddress Address to receive rewards
     * @param commission Commission rate in basis points (100 = 1%)
     * @param publicKey Public key for block signing
     */
    function registerSequencer(
        address rewardAddress,
        uint256 commission,
        bytes calldata publicKey
    ) external payable whenNotPaused nonReentrant {
        if (msg.value < MIN_STAKE) revert InsufficientStake();
        if (rewardAddress == address(0)) revert InvalidRewardAddress();
        if (commission < minCommissionRate || commission > maxCommissionRate) revert InvalidCommissionRate();
        if (publicKey.length != 64) revert InvalidPublicKeyLength();
        if (sequencers[msg.sender].operator != address(0)) revert SequencerAlreadyRegistered();
        if (activeSequencers.length >= MAX_SEQUENCERS) revert MaxSequencersReached();

        sequencers[msg.sender] = Sequencer({
            operator: msg.sender,
            rewardAddress: rewardAddress,
            stake: msg.value,
            delegatedStake: 0,
            commission: commission,
            status: SequencerStatus.Active,
            jailTime: 0,
            lastBlockTime: block.timestamp,
            blocksProduced: 0,
            missedBlocks: 0,
            registrationTime: block.timestamp,
            exitTime: 0,
            publicKey: publicKey
        });

        sequencerMetrics[msg.sender] = SequencerMetrics({
            totalBlocks: 0,
            producedBlocks: 0,
            uptimePercentage: 10000, // Start with 100%
            lastUpdateTime: block.timestamp
        });

        activeSequencers.push(msg.sender);
        totalStaked += msg.value;

        emit SequencerRegistered(msg.sender, rewardAddress, msg.value, commission, publicKey);
    }

    /**
     * @dev Update sequencer information
     * @param newRewardAddress New reward address
     * @param newCommission New commission rate
     */
    function updateSequencer(
        address newRewardAddress,
        uint256 newCommission
    ) external whenNotPaused {
        if (sequencers[msg.sender].operator == address(0)) revert NotASequencer();
        if (newRewardAddress == address(0)) revert InvalidRewardAddress();
        if (newCommission < minCommissionRate || newCommission > maxCommissionRate) revert InvalidCommissionRate();

        sequencers[msg.sender].rewardAddress = newRewardAddress;
        sequencers[msg.sender].commission = newCommission;

        emit SequencerUpdated(msg.sender, newRewardAddress, newCommission);
    }

    /**
     * @dev Delegate stake to a sequencer
     * @param sequencer Address of the sequencer to delegate to
     */
    function delegateStake(address sequencer) external payable whenNotPaused nonReentrant {
        if (msg.value == 0) revert InvalidDelegationAmount();
        if (sequencers[sequencer].operator == address(0)) revert SequencerNotFound();
        if (sequencers[sequencer].status != SequencerStatus.Active) revert SequencerNotActive();

        delegations[msg.sender][sequencer].amount += msg.value;
        delegations[msg.sender][sequencer].timestamp = block.timestamp;
        
        sequencers[sequencer].delegatedStake += msg.value;
        totalStaked += msg.value;

        emit StakeDelegated(msg.sender, sequencer, msg.value);
    }

    /**
     * @dev Initiate stake undelegation
     * @param sequencer Address of the sequencer to undelegate from
     * @param amount Amount to undelegate
     */
    function initiateUndelegation(
        address sequencer,
        uint256 amount
    ) external whenNotPaused {
        if (amount == 0) revert InvalidDelegationAmount();
        if (delegations[msg.sender][sequencer].amount < amount) revert InsufficientDelegation();
        if (delegations[msg.sender][sequencer].withdrawTime != 0) revert WithdrawalAlreadyInitiated();

        delegations[msg.sender][sequencer].withdrawTime = block.timestamp;
        
        emit StakeUndelegated(msg.sender, sequencer, amount);
    }

    /**
     * @dev Complete stake undelegation after delay
     * @param sequencer Address of the sequencer
     */
    function completeUndelegation(address sequencer) external nonReentrant {
        Delegation storage delegation = delegations[msg.sender][sequencer];
        
        if (delegation.withdrawTime == 0) revert NoWithdrawalInitiated();
        if (block.timestamp < delegation.withdrawTime + exitDelay) revert WithdrawalDelayNotMet();
        
        uint256 amount = delegation.amount;
        delegation.amount = 0;
        delegation.withdrawTime = 0;
        
        sequencers[sequencer].delegatedStake -= amount;
        totalStaked -= amount;
        
        (bool success, ) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    /**
     * @dev Record block production
     * @param sequencer Address of the sequencer
     * @param blockNumber Block number produced
     */
    function recordBlockProduction(
        address sequencer,
        uint256 blockNumber
    ) external onlyRole(ADMIN_ROLE) {
        if (sequencers[sequencer].operator == address(0)) revert SequencerNotFound();
        
        sequencers[sequencer].lastBlockTime = block.timestamp;
        sequencers[sequencer].blocksProduced++;
        
        SequencerMetrics storage metrics = sequencerMetrics[sequencer];
        metrics.producedBlocks++;
        metrics.totalBlocks++;
        
        _updateUptimeMetrics(sequencer);
        
        emit BlockProduced(sequencer, blockNumber, block.timestamp);
    }

    /**
     * @dev Record missed block
     * @param sequencer Address of the sequencer
     */
    function recordMissedBlock(address sequencer) external onlyRole(ADMIN_ROLE) {
        if (sequencers[sequencer].operator == address(0)) revert SequencerNotFound();
        
        sequencers[sequencer].missedBlocks++;
        sequencerMetrics[sequencer].totalBlocks++;
        
        _updateUptimeMetrics(sequencer);
        
        // Check if sequencer should be jailed for poor performance
        if (sequencerMetrics[sequencer].uptimePercentage < MIN_UPTIME_PERCENTAGE) {
            _jailSequencer(sequencer, "Poor uptime performance");
        }
    }

    /**
     * @dev Jail a sequencer
     * @param sequencer Address of the sequencer to jail
     * @param reason Reason for jailing
     */
    function jailSequencer(
        address sequencer,
        string calldata reason
    ) external onlyRole(SLASHER_ROLE) {
        if (sequencers[sequencer].operator == address(0)) revert SequencerNotFound();
        if (sequencers[sequencer].status != SequencerStatus.Active) revert SequencerNotActive();
        _jailSequencer(sequencer, reason);
    }

    /**
     * @dev Unjail a sequencer after jail period
     * @param sequencer Address of the sequencer to unjail
     */
    function unjailSequencer(address sequencer) external {
        if (sequencers[sequencer].status != SequencerStatus.Jailed) revert SequencerNotJailed();
        if (block.timestamp < sequencers[sequencer].jailTime + jailDuration) revert JailPeriodNotCompleted();
        
        sequencers[sequencer].status = SequencerStatus.Active;
        sequencers[sequencer].jailTime = 0;
        
        // Add back to active sequencers if not already present
        bool found = false;
        for (uint256 i = 0; i < activeSequencers.length; i++) {
            if (activeSequencers[i] == sequencer) {
                found = true;
                break;
            }
        }
        
        if (!found) {
            activeSequencers.push(sequencer);
        }
        
        emit SequencerUnjailed(sequencer);
    }

    /**
     * @dev Slash a sequencer's stake
     * @param sequencer Address of the sequencer to slash
     * @param percentage Percentage to slash (basis points)
     * @param reason Reason for slashing
     */
    function slashSequencer(
        address sequencer,
        uint256 percentage,
        string calldata reason
    ) external onlyRole(SLASHER_ROLE) {
        if (sequencers[sequencer].operator == address(0)) revert SequencerNotFound();
        if (percentage > 10000) revert InvalidPercentage();
        
        uint256 slashAmount = (sequencers[sequencer].stake * percentage) / 10000;
        sequencers[sequencer].stake -= slashAmount;
        totalStaked -= slashAmount;
        
        emit SequencerSlashed(sequencer, slashAmount, reason);
        
        // Jail sequencer if stake falls below minimum
        if (sequencers[sequencer].stake < MIN_STAKE) {
            _jailSequencer(sequencer, "Stake below minimum");
        }
    }

    /**
     * @dev Get current active sequencer
     * @return Address of current sequencer
     */
    function getCurrentSequencer() external view returns (address) {
        if (activeSequencers.length == 0) {
            return address(0);
        }
        
        return activeSequencers[currentSequencerIndex % activeSequencers.length];
    }

    /**
     * @dev Rotate to next sequencer
     */
    function rotateSequencer() external {
        if (block.timestamp < lastRotationTime + ROTATION_PERIOD) revert RotationPeriodNotMet();
        if (activeSequencers.length == 0) revert NoActiveSequencers();
        
        address oldSequencer = activeSequencers[currentSequencerIndex % activeSequencers.length];
        currentSequencerIndex = (currentSequencerIndex + 1) % activeSequencers.length;
        address newSequencer = activeSequencers[currentSequencerIndex];
        
        lastRotationTime = block.timestamp;
        
        emit SequencerRotated(oldSequencer, newSequencer, block.timestamp);
    }

    /**
     * @dev Internal function to jail a sequencer
     * @param sequencer Address of the sequencer
     * @param reason Reason for jailing
     */
    function _jailSequencer(address sequencer, string memory reason) internal {
        sequencers[sequencer].status = SequencerStatus.Jailed;
        sequencers[sequencer].jailTime = block.timestamp;
        
        // Remove from active sequencers
        for (uint256 i = 0; i < activeSequencers.length; i++) {
            if (activeSequencers[i] == sequencer) {
                activeSequencers[i] = activeSequencers[activeSequencers.length - 1];
                activeSequencers.pop();
                break;
            }
        }
        
        emit SequencerJailed(sequencer, reason, block.timestamp);
    }

    /**
     * @dev Update uptime metrics for a sequencer
     * @param sequencer Address of the sequencer
     */
    function _updateUptimeMetrics(address sequencer) internal {
        SequencerMetrics storage metrics = sequencerMetrics[sequencer];
        
        if (metrics.totalBlocks > 0) {
            metrics.uptimePercentage = (metrics.producedBlocks * 10000) / metrics.totalBlocks;
        }
        
        metrics.lastUpdateTime = block.timestamp;
    }

    /**
     * @dev Get sequencer information
     * @param sequencer Address of the sequencer
     * @return Sequencer struct
     */
    function getSequencer(address sequencer) external view returns (Sequencer memory) {
        return sequencers[sequencer];
    }

    /**
     * @dev Get active sequencers count
     * @return Number of active sequencers
     */
    function getActiveSequencersCount() external view returns (uint256) {
        return activeSequencers.length;
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
     * @dev Authorize contract upgrades
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(ADMIN_ROLE) {
        if (newImplementation == address(0)) revert InvalidImplementation();
    }

    /**
     * @dev Receive function to accept ETH
     */
    receive() external payable {
        // Allow contract to receive ETH for staking
    }
}