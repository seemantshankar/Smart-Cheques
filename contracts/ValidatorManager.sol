// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {GovernanceToken} from "./GovernanceToken.sol";

/**
 * @title ValidatorManager
 * @dev Manages validator registration, slashing, and consensus operations
 * @notice Handles validator lifecycle and consensus mechanism
 */
contract ValidatorManager is AccessControl, ReentrancyGuard, Pausable {
    using SafeMath for uint256;
    using SafeERC20 for GovernanceToken;
    
    // Custom errors
    error InsufficientStake();
    error ValidatorAlreadyRegistered();
    error CommissionTooHigh();
    error MaxValidatorsReached();
    error ValidatorNotActive();
    error InvalidAmount();
    error InsufficientDelegation();
    error ValidatorNotJailed();
    error InvalidAddress();
    error TooManyOracles();
    error TooManySequencers();
    error SlashingPercentageTooHigh();
    error ValidatorIsJailed();
    
    // Roles
    bytes32 public constant SLASHER_ROLE = keccak256("SLASHER_ROLE");
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant SEQUENCER_ROLE = keccak256("SEQUENCER_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    
    // Validator status
    enum ValidatorStatus {
        INACTIVE,
        ACTIVE,
        JAILED,
        SLASHED,
        EXITING
    }
    
    // Slashing reasons
    enum SlashingReason {
        DOUBLE_SIGNING,
        DOWNTIME,
        INVALID_BLOCK,
        CONSENSUS_FAILURE,
        MALICIOUS_BEHAVIOR
    }
    
    // Validator information
    struct ValidatorInfo {
        address validator;
        uint256 stake;
        uint256 delegatedStake;
        ValidatorStatus status;
        uint256 jailTime;
        uint256 jailedUntil;
        uint256 lastActiveBlock;
        uint256 missedBlocks;
        uint256 totalSlashed;
        bytes32 publicKey;
        string moniker;
        uint256 commission; // Basis points (100 = 1%)
        uint256 registrationTime;
    }
    
    // Delegation information
    struct DelegationInfo {
        uint256 amount;
        uint256 timestamp;
        uint256 rewards;
        uint256 lastClaimTime;
    }
    
    // Slashing event
    struct SlashingEvent {
        address validator;
        SlashingReason reason;
        uint256 amount;
        uint256 timestamp;
        uint256 blockNumber;
        bytes evidence;
    }
    
    // State variables
    GovernanceToken public immutable governanceToken;
    
    mapping(address => ValidatorInfo) public validators;
    mapping(address => mapping(address => DelegationInfo)) public delegations;
    mapping(address => uint256) public validatorIndex;
    mapping(uint256 => SlashingEvent) public slashingEvents;
    
    address[] public activeValidators;
    uint256 public totalActiveStake;
    uint256 public totalDelegatedStake;
    uint256 public slashingEventCount;
    
    // Configuration struct to reduce state variable count
    struct ValidatorConfig {
        uint256 minValidatorStake; // 50k tokens
        uint256 maxValidators;
        uint256 jailDuration;
        uint256 slashingPercentages; // 5% in basis points
        uint256 downtimeThreshold; // 50 missed blocks
        uint256 blockReward; // 10 tokens per block
        uint256 maxCommission; // 20% in basis points
    }
    
    ValidatorConfig public validatorConfig;
    
    // Events
    event ValidatorRegistered(address indexed validator, uint256 stake, string moniker);
    event ValidatorActivated(address indexed validator);
    event ValidatorJailed(address indexed validator, SlashingReason reason);
    event ValidatorSlashed(address indexed validator, SlashingReason reason, uint256 amount);
    event ValidatorUnjailed(address indexed validator);
    event DelegationAdded(address indexed delegator, address indexed validator, uint256 amount);
    event DelegationRemoved(address indexed delegator, address indexed validator, uint256 amount);
    event BlockProduced(address indexed validator, uint256 blockNumber, uint256 reward);
    
    address public TREASURY_ADDRESS;

    constructor(address _governanceToken) {
        governanceToken = GovernanceToken(_governanceToken);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(GOVERNANCE_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        TREASURY_ADDRESS = msg.sender; // default; should be set post-deploy via governance to TREASURY_ADDRESS
        
        // Initialize configuration
        validatorConfig = ValidatorConfig({
            minValidatorStake: 50_000 * 10**18, // 50k tokens
            maxValidators: 100,
            jailDuration: 7 days,
            slashingPercentages: 500, // 5% in basis points
            downtimeThreshold: 50, // 50 missed blocks
            blockReward: 10 * 10**18, // 10 tokens per block
            maxCommission: 2000 // 20% in basis points
        });
    }
    
    /**
     * @dev Register as a validator
     * @param stake Amount to stake
     * @param publicKey Validator public key
     * @param moniker Validator name
     * @param commission Commission rate in basis points
     */
    function registerValidator(
        uint256 stake,
        bytes32 publicKey,
        string memory moniker,
        uint256 commission
    ) external nonReentrant whenNotPaused {
        if (stake < validatorConfig.minValidatorStake) revert InsufficientStake();
        if (validators[msg.sender].validator != address(0)) revert ValidatorAlreadyRegistered();
        if (commission > validatorConfig.maxCommission) revert CommissionTooHigh();
        if (activeValidators.length >= validatorConfig.maxValidators) revert MaxValidatorsReached();
        
        // Transfer stake to contract
        governanceToken.safeTransferFrom(msg.sender, address(this), stake);
        
        // Register validator
        validators[msg.sender] = ValidatorInfo({
            validator: msg.sender,
            stake: stake,
            delegatedStake: 0,
            status: ValidatorStatus.ACTIVE,
            jailTime: 0,
            jailedUntil: 0,
            lastActiveBlock: block.number,
            missedBlocks: 0,
            totalSlashed: 0,
            publicKey: publicKey,
            moniker: moniker,
            commission: commission,
            registrationTime: block.timestamp
        });
        
        // Add to active validators
        activeValidators.push(msg.sender);
        validatorIndex[msg.sender] = activeValidators.length - 1;
        totalActiveStake = totalActiveStake.add(stake);
        
        emit ValidatorRegistered(msg.sender, stake, moniker);
        emit ValidatorActivated(msg.sender);
    }
    
    /**
     * @dev Delegate tokens to a validator
     * @param validator Validator to delegate to
     * @param amount Amount to delegate
     */
    function delegate(address validator, uint256 amount) external nonReentrant whenNotPaused {
        if (validators[validator].status != ValidatorStatus.ACTIVE) revert ValidatorNotActive();
        if (amount == 0) revert InvalidAmount();
        
        // Transfer tokens to contract
        governanceToken.safeTransferFrom(msg.sender, address(this), amount);
        
        // Update delegation
        DelegationInfo storage delegation = delegations[msg.sender][validator];
        delegation.amount = delegation.amount.add(amount);
        delegation.timestamp = block.timestamp;
        
        // Update validator delegated stake
        validators[validator].delegatedStake = validators[validator].delegatedStake.add(amount);
        totalDelegatedStake = totalDelegatedStake.add(amount);
        
        emit DelegationAdded(msg.sender, validator, amount);
    }
    
    /**
     * @dev Undelegate tokens from a validator
     * @param validator Validator to undelegate from
     * @param amount Amount to undelegate
     */
    function undelegate(address validator, uint256 amount) external nonReentrant {
        DelegationInfo storage delegation = delegations[msg.sender][validator];
        if (delegation.amount < amount) revert InsufficientDelegation();
        
        // Update delegation
        delegation.amount = delegation.amount.sub(amount);
        
        // Update validator delegated stake
        validators[validator].delegatedStake = validators[validator].delegatedStake.sub(amount);
        totalDelegatedStake = totalDelegatedStake.sub(amount);
        
        // Transfer tokens back (with unbonding period in production)
        governanceToken.safeTransfer(msg.sender, amount);
        
        emit DelegationRemoved(msg.sender, validator, amount);
    }
    
    /**
     * @dev Slash a validator for misbehavior
     * @param validator Validator to slash
     * @param reason Reason for slashing
     * @param evidence Evidence of misbehavior
     */
    function slashValidator(
        address validator,
        SlashingReason reason,
        bytes memory evidence
    ) external onlyRole(SLASHER_ROLE) {
        ValidatorInfo storage validatorInfo = validators[validator];
        if (validatorInfo.status != ValidatorStatus.ACTIVE) revert ValidatorNotActive();
        
        uint256 slashAmount = validatorInfo.stake.mul(validatorConfig.slashingPercentages).div(10000);
        
        // Apply slashing
        validatorInfo.stake = validatorInfo.stake.sub(slashAmount);
        validatorInfo.totalSlashed = validatorInfo.totalSlashed.add(slashAmount);
        validatorInfo.status = ValidatorStatus.SLASHED;
        
        // Remove from active validators if stake falls below minimum
        if (validatorInfo.stake < validatorConfig.minValidatorStake) {
            _removeFromActiveValidators(validator);
        }
        
        // Record slashing event
        slashingEvents[slashingEventCount] = SlashingEvent({
            validator: validator,
            reason: reason,
            amount: slashAmount,
            timestamp: block.timestamp,
            blockNumber: block.number,
            evidence: evidence
        });
        slashingEventCount++;
        
        // Transfer slashed tokens to treasury or governance
        address slashAddress = getSlashAddress();
        if (slashAddress == address(0)) revert InvalidAddress();
        governanceToken.safeTransfer(slashAddress, slashAmount);
        
        emit ValidatorSlashed(validator, reason, slashAmount);
    }
    
    /**
     * @dev Jail a validator for downtime or minor infractions
     * @param validator Validator to jail
     * @param reason Reason for jailing
     */
    function jailValidator(address validator, SlashingReason reason) external onlyRole(SLASHER_ROLE) {
        ValidatorInfo storage validatorInfo = validators[validator];
        if (validatorInfo.status != ValidatorStatus.ACTIVE) revert ValidatorNotActive();
        
        validatorInfo.status = ValidatorStatus.JAILED;
        validatorInfo.jailTime = block.timestamp;
        
        _removeFromActiveValidators(validator);
        
        emit ValidatorJailed(validator, reason);
    }
    
    /**
     * @dev Unjail a validator after jail period
     */
    function unjailValidator() external {
        ValidatorInfo storage validatorInfo = validators[msg.sender];
        if (validatorInfo.status != ValidatorStatus.JAILED) revert ValidatorNotJailed();
        if (block.timestamp < validatorInfo.jailTime.add(validatorConfig.jailDuration)) revert InvalidAmount();
        if (validatorInfo.stake < validatorConfig.minValidatorStake) revert InsufficientStake();
        if (activeValidators.length >= validatorConfig.maxValidators) revert MaxValidatorsReached();
        
        validatorInfo.status = ValidatorStatus.ACTIVE;
        validatorInfo.jailTime = 0;
        validatorInfo.missedBlocks = 0;
        
        // Add back to active validators
        activeValidators.push(msg.sender);
        validatorIndex[msg.sender] = activeValidators.length - 1;
        
        emit ValidatorUnjailed(msg.sender);
    }
    
    /**
     * @dev Record block production and distribute rewards
     * @param validator Validator who produced the block
     * @param blockNumber Block number produced
     */
    function recordBlockProduction(address validator, uint256 blockNumber) 
        external 
        onlyRole(ORACLE_ROLE) 
    {
        if (!isValidatorActive(validator)) revert ValidatorNotActive();
        if (isJailed(validator)) revert ValidatorIsJailed();
        
        ValidatorInfo storage validatorInfo = validators[validator];
        if (validatorInfo.stake < validatorConfig.minValidatorStake) revert InsufficientStake();
        
        validatorInfo.lastActiveBlock = blockNumber;
        validatorInfo.missedBlocks = 0; // Reset missed blocks counter
        
        // Distribute block reward
        uint256 validatorReward = validatorConfig.blockReward.mul(10000 - validatorInfo.commission).div(10000);
        uint256 commissionReward = validatorConfig.blockReward.sub(validatorReward);
        
        // Mint rewards
        governanceToken.safeTransfer(validator, validatorReward);
        if (commissionReward > 0) {
            governanceToken.safeTransfer(validator, commissionReward);
        }
        
        emit BlockProduced(validator, blockNumber, validatorConfig.blockReward);
    }
    
    /**
     * @dev Check if validator is active
     * @param validator Validator address to check
     * @return bool True if validator is active
     */
    function isValidatorActive(address validator) public view returns (bool) {
        ValidatorInfo storage validatorInfo = validators[validator];
        return validatorInfo.status == ValidatorStatus.ACTIVE &&
               !isJailed(validator) &&
               validatorInfo.stake >= validatorConfig.minValidatorStake;
    }
    
    /**
     * @dev Check if validator is jailed
     * @param validator Validator address to check
     * @return bool True if validator is jailed
     */
    function isJailed(address validator) public view returns (bool) {
        ValidatorInfo storage validatorInfo = validators[validator];
        return validatorInfo.status == ValidatorStatus.JAILED ||
               (validatorInfo.jailedUntil > 0 && block.timestamp < validatorInfo.jailedUntil);
    }
    
    /**
     * @dev Get slash address for slashed tokens
     * @return address Address to send slashed tokens
     */
    function getSlashAddress() internal view returns (address) {
        return TREASURY_ADDRESS;
    }

    /**
     * @dev Sets the treasury address that receives slashed tokens
     */
    function setTreasuryAddress(address newTreasury) external onlyRole(GOVERNANCE_ROLE) {
        if (newTreasury == address(0)) revert InvalidAddress();
        TREASURY_ADDRESS = newTreasury;
    }

    /**
     * @dev Grant oracle role to an address
     * @param oracle Address to grant oracle role
     */
    function grantOracleRole(address oracle) external onlyRole(ADMIN_ROLE) {
        if (oracle == address(0)) revert InvalidAddress();
        _grantRole(ORACLE_ROLE, oracle);
    }

    /**
     * @dev Revoke oracle role from an address
     * @param oracle Address to revoke oracle role
     */
    function revokeOracleRole(address oracle) external onlyRole(ADMIN_ROLE) {
        _revokeRole(ORACLE_ROLE, oracle);
    }

    /**
     * @dev Grant sequencer role to an address
     * @param sequencer Address to grant sequencer role
     */
    function grantSequencerRole(address sequencer) external onlyRole(ADMIN_ROLE) {
        if (sequencer == address(0)) revert InvalidAddress();
        _grantRole(SEQUENCER_ROLE, sequencer);
    }

    /**
     * @dev Revoke sequencer role from an address
     * @param sequencer Address to revoke sequencer role
     */
    function revokeSequencerRole(address sequencer) external onlyRole(ADMIN_ROLE) {
        _revokeRole(SEQUENCER_ROLE, sequencer);
    }

    /**
     * @dev Batch grant roles for initial setup
     * @param oracles Array of oracle addresses
     * @param sequencers Array of sequencer addresses
     */
    function batchSetupRoles(
        address[] calldata oracles,
        address[] calldata sequencers
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (oracles.length > 20) revert TooManyOracles();
        if (sequencers.length > 10) revert TooManySequencers();
        
        // Grant oracle roles
        for (uint256 i = 0; i < oracles.length; i++) {
            if (oracles[i] != address(0)) {
                _grantRole(ORACLE_ROLE, oracles[i]);
            }
        }
        
        // Grant sequencer roles
        for (uint256 i = 0; i < sequencers.length; i++) {
            if (sequencers[i] != address(0)) {
                _grantRole(SEQUENCER_ROLE, sequencers[i]);
            }
        }
    }
    
    /**
     * @dev Record missed block for downtime tracking
     * @param validator Validator who missed the block
     */
    function recordMissedBlock(address validator) external onlyRole(ORACLE_ROLE) {
        ValidatorInfo storage validatorInfo = validators[validator];
        if (validatorInfo.status != ValidatorStatus.ACTIVE) return;
        
        validatorInfo.missedBlocks++;
        
        // Jail for excessive downtime
        if (validatorInfo.missedBlocks >= validatorConfig.downtimeThreshold) {
            _jailValidator(validator, SlashingReason.DOWNTIME);
        }
    }
    
    /**
     * @dev Internal function to jail a validator
     * @param validator Validator to jail
     * @param reason Reason for jailing
     */
    function _jailValidator(address validator, SlashingReason reason) internal {
         ValidatorInfo storage validatorInfo = validators[validator];
         if (validatorInfo.status != ValidatorStatus.ACTIVE) revert ValidatorNotActive();
         
         validatorInfo.status = ValidatorStatus.JAILED;
         validatorInfo.jailedUntil = block.timestamp + validatorConfig.jailDuration;
         
         _removeFromActiveValidators(validator);
         
         emit ValidatorJailed(validator, reason);
     }
    
    /**
     * @dev Remove validator from active set
     * @param validator Validator to remove
     */
    function _removeFromActiveValidators(address validator) internal {
        uint256 index = validatorIndex[validator];
        uint256 lastIndex = activeValidators.length - 1;
        
        if (index != lastIndex) {
            address lastValidator = activeValidators[lastIndex];
            activeValidators[index] = lastValidator;
            validatorIndex[lastValidator] = index;
        }
        
        activeValidators.pop();
        delete validatorIndex[validator];
        
        totalActiveStake = totalActiveStake.sub(validators[validator].stake);
    }
    
    /**
     * @dev Get active validators
     * @return Array of active validator addresses
     */
    function getActiveValidators() external view returns (address[] memory) {
        return activeValidators;
    }

    /**
     * @dev Get validator stake and active status
     * @param validator Validator address
     * @return stake Amount staked by validator
     * @return isActive Whether validator is active
     */
    function getValidatorStake(address validator) external view returns (uint256 stake, bool isActive) {
        ValidatorInfo memory info = validators[validator];
        stake = info.stake;
        isActive = info.status == ValidatorStatus.ACTIVE;
    }
    
    /**
     * @dev Get validator information
     * @param validator Validator address
     * @return ValidatorInfo struct
     */
    function getValidatorInfo(address validator) external view returns (ValidatorInfo memory) {
        return validators[validator];
    }
    
    /**
     * @dev Get delegation information
     * @param delegator Delegator address
     * @param validator Validator address
     * @return DelegationInfo struct
     */
    function getDelegationInfo(address delegator, address validator) 
        external 
        view 
        returns (DelegationInfo memory) 
    {
        return delegations[delegator][validator];
    }
    
    // Governance functions
    function setMinValidatorStake(uint256 _minStake) external onlyRole(GOVERNANCE_ROLE) {
        validatorConfig.minValidatorStake = _minStake;
    }
    
    function setMaxValidators(uint256 _maxValidators) external onlyRole(GOVERNANCE_ROLE) {
        validatorConfig.maxValidators = _maxValidators;
    }
    
    function setSlashingPercentage(uint256 _percentage) external onlyRole(GOVERNANCE_ROLE) {
        if (_percentage > 5000) revert SlashingPercentageTooHigh(); // Max 50%
        validatorConfig.slashingPercentages = _percentage;
    }
    
    function setBlockReward(uint256 _reward) external onlyRole(GOVERNANCE_ROLE) {
        validatorConfig.blockReward = _reward;
    }
    
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }
    
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}