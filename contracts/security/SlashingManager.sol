// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title SlashingManager
 * @dev Manages slashing conditions and penalties for validators
 * Handles different types of validator misbehavior and applies appropriate penalties
 */
contract SlashingManager is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant SLASHER_ROLE = keccak256("SLASHER_ROLE");
    bytes32 public constant EVIDENCE_SUBMITTER_ROLE = keccak256("EVIDENCE_SUBMITTER_ROLE");
    bytes32 public constant VALIDATOR_MANAGER_ROLE = keccak256("VALIDATOR_MANAGER_ROLE");

    // Slashing types
    enum SlashingType {
        DOUBLE_SIGNING,
        DOWNTIME,
        INVALID_STATE_TRANSITION,
        CENSORSHIP,
        PROTOCOL_VIOLATION,
        FRAUD_PROOF_FAILURE
    }

    // Slashing severity levels
    enum SlashingSeverity {
        MINOR,      // Warning + small penalty
        MODERATE,   // Partial stake slash
        MAJOR,      // Significant stake slash
        CRITICAL    // Full stake slash + jail
    }

    // Slashing configuration
    struct SlashingConfig {
        uint256 penaltyPercentage;  // Percentage of stake to slash (basis points)
        uint256 jailDuration;       // Duration of jailing in seconds
        bool requiresEvidence;      // Whether evidence is required
        uint256 evidenceTimeout;    // Time limit for evidence submission
        SlashingSeverity severity;  // Severity level
    }

    // Slashing evidence
    struct SlashingEvidence {
        bytes32 evidenceHash;       // Hash of evidence data
        address submitter;          // Who submitted the evidence
        uint256 timestamp;          // When evidence was submitted
        bool verified;              // Whether evidence has been verified
        string ipfsHash;            // IPFS hash for detailed evidence
    }

    // Slashing record
    struct SlashingRecord {
        address validator;          // Validator address
        SlashingType slashingType;  // Type of violation
        uint256 amount;             // Amount slashed
        uint256 timestamp;          // When slashing occurred
        bytes32 evidenceHash;       // Associated evidence
        bool appealed;              // Whether validator appealed
        bool resolved;              // Whether appeal was resolved
    }

    // Validator jail information
    struct JailInfo {
        bool isJailed;              // Whether validator is jailed
        uint256 jailStartTime;      // When jailing started
        uint256 jailDuration;       // Duration of jailing
        uint256 releaseTime;        // When validator can be released
        SlashingType reason;        // Reason for jailing
    }

    // State variables
    IERC20 public stakingToken;
    address public validatorManager;
    address public treasury;
    
    // Slashing configurations for each type
    mapping(SlashingType => SlashingConfig) public slashingConfigs;
    
    // Evidence storage
    mapping(bytes32 => SlashingEvidence) public evidenceRecords;
    
    // Slashing records
    mapping(uint256 => SlashingRecord) public slashingRecords;
    mapping(address => SlashingRecord[]) public validatorSlashings;
    
    // Statistics
    uint256 public totalSlashingRecords;
    uint256 public totalSlashedAmount;
    mapping(SlashingType => uint256) public slashingCounts;
    mapping(address => uint256) public validatorSlashingCounts;
    
    // Jail information
    mapping(address => JailInfo) public jailInfo;
    
    // Appeal system
    mapping(address => mapping(uint256 => bool)) public appeals;
    mapping(address => uint256) public appealCounts;
    
    // Configuration parameters
    uint256 public maxSlashingPercentage;
    uint256 public appealWindow;
    uint256 public evidenceSubmissionWindow;
    uint256 public minStakeForSlashing;
    
    // Events
    event ValidatorSlashed(
        address indexed validator,
        SlashingType indexed slashingType,
        uint256 amount,
        bytes32 evidenceHash
    );
    
    event ValidatorJailed(
        address indexed validator,
        SlashingType indexed reason,
        uint256 jailDuration,
        uint256 releaseTime
    );
    
    event ValidatorUnjailed(
        address indexed validator,
        uint256 timestamp
    );
    
    event EvidenceSubmitted(
        bytes32 indexed evidenceHash,
        address indexed submitter,
        address indexed validator,
        SlashingType slashingType
    );
    
    event EvidenceVerified(
        bytes32 indexed evidenceHash,
        address indexed verifier,
        bool verified
    );
    
    event SlashingAppealed(
        address indexed validator,
        uint256 indexed recordId,
        uint256 timestamp
    );
    
    event SlashingConfigUpdated(
        SlashingType indexed slashingType,
        uint256 penaltyPercentage,
        uint256 jailDuration,
        SlashingSeverity severity
    );

    // Custom errors
    error InvalidStakingToken();
    error InvalidValidatorManager();
    error InvalidTreasury();
    error InvalidValidatorAddress();
    error InvalidSlashingType();
    error InvalidPenaltyPercentage();

    error InvalidEvidenceHash();
    error InvalidEvidenceData();
    error EvidenceAlreadySubmitted();
    error EvidenceNotVerified();

    error ValidatorNotJailed();
    error JailPeriodNotExpired();
    error InsufficientStake();
    error AppealPeriodExpired();


    error InvalidRecordId();
    error NotYourSlashingRecord();
    error AlreadyAppealed();
    error AlreadyResolved();
    error PenaltyTooHigh();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initialize the slashing manager
     * @param _stakingToken Address of the staking token
     * @param _validatorManager Address of the validator manager
     * @param _treasury Address of the treasury
     */
    function initialize(
        address _stakingToken,
        address _validatorManager,
        address _treasury
    ) public initializer {
        if (_stakingToken == address(0)) revert InvalidStakingToken();
        if (_validatorManager == address(0)) revert InvalidValidatorManager();
        if (_treasury == address(0)) revert InvalidTreasury();

        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        stakingToken = IERC20(_stakingToken);
        validatorManager = _validatorManager;
        treasury = _treasury;

        // Set up roles
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(SLASHER_ROLE, msg.sender);
        _grantRole(EVIDENCE_SUBMITTER_ROLE, msg.sender);
        _grantRole(VALIDATOR_MANAGER_ROLE, _validatorManager);

        // Initialize default configurations
        _initializeDefaultConfigs();
        
        // Set default parameters
        maxSlashingPercentage = 10000; // 100%
        appealWindow = 7 days;
        evidenceSubmissionWindow = 24 hours;
        minStakeForSlashing = 1000e18; // 1000 tokens
    }

    /**
     * @dev Initialize default slashing configurations
     */
    function _initializeDefaultConfigs() internal {
        // Double signing - Critical violation
        slashingConfigs[SlashingType.DOUBLE_SIGNING] = SlashingConfig({
            penaltyPercentage: 500,  // 5%
            jailDuration: 7 days,
            requiresEvidence: true,
            evidenceTimeout: 24 hours,
            severity: SlashingSeverity.CRITICAL
        });

        // Downtime - Moderate violation
        slashingConfigs[SlashingType.DOWNTIME] = SlashingConfig({
            penaltyPercentage: 100,  // 1%
            jailDuration: 1 days,
            requiresEvidence: false,
            evidenceTimeout: 0,
            severity: SlashingSeverity.MODERATE
        });

        // Invalid state transition - Major violation
        slashingConfigs[SlashingType.INVALID_STATE_TRANSITION] = SlashingConfig({
            penaltyPercentage: 1000, // 10%
            jailDuration: 14 days,
            requiresEvidence: true,
            evidenceTimeout: 48 hours,
            severity: SlashingSeverity.MAJOR
        });

        // Censorship - Major violation
        slashingConfigs[SlashingType.CENSORSHIP] = SlashingConfig({
            penaltyPercentage: 300,  // 3%
            jailDuration: 3 days,
            requiresEvidence: true,
            evidenceTimeout: 24 hours,
            severity: SlashingSeverity.MAJOR
        });

        // Protocol violation - Moderate violation
        slashingConfigs[SlashingType.PROTOCOL_VIOLATION] = SlashingConfig({
            penaltyPercentage: 200,  // 2%
            jailDuration: 2 days,
            requiresEvidence: true,
            evidenceTimeout: 12 hours,
            severity: SlashingSeverity.MODERATE
        });

        // Fraud proof failure - Critical violation
        slashingConfigs[SlashingType.FRAUD_PROOF_FAILURE] = SlashingConfig({
            penaltyPercentage: 2000, // 20%
            jailDuration: 30 days,
            requiresEvidence: true,
            evidenceTimeout: 72 hours,
            severity: SlashingSeverity.CRITICAL
        });
    }

    /**
     * @dev Submit evidence for slashing
     * @param validator Validator to be slashed
     * @param slashingType Type of violation
     * @param evidenceHash Hash of the evidence
     * @param ipfsHash IPFS hash for detailed evidence
     * @return evidenceId The evidence identifier
     */
    function submitEvidence(
        address validator,
        SlashingType slashingType,
        bytes32 evidenceHash,
        string memory ipfsHash
    ) external onlyRole(EVIDENCE_SUBMITTER_ROLE) returns (bytes32) {
        if (validator == address(0)) revert InvalidValidatorAddress();
        if (evidenceHash == bytes32(0)) revert InvalidEvidenceHash();
        
        SlashingConfig memory config = slashingConfigs[slashingType];
        if (!config.requiresEvidence) revert InvalidSlashingType();
        
        bytes32 evidenceId = keccak256(abi.encodePacked(
            validator,
            slashingType,
            evidenceHash,
            block.timestamp,
            msg.sender
        ));
        
        evidenceRecords[evidenceId] = SlashingEvidence({
            evidenceHash: evidenceHash,
            submitter: msg.sender,
            timestamp: block.timestamp,
            verified: false,
            ipfsHash: ipfsHash
        });
        
        emit EvidenceSubmitted(evidenceId, msg.sender, validator, slashingType);
        return evidenceId;
    }

    /**
     * @dev Verify submitted evidence
     * @param evidenceId Evidence identifier
     * @param verified Whether evidence is valid
     */
    function verifyEvidence(
        bytes32 evidenceId,
        bool verified
    ) external onlyRole(ADMIN_ROLE) {
        if (evidenceRecords[evidenceId].submitter == address(0)) revert InvalidEvidenceData();
        if (evidenceRecords[evidenceId].verified) revert EvidenceAlreadySubmitted();
        
        evidenceRecords[evidenceId].verified = verified;
        emit EvidenceVerified(evidenceId, msg.sender, verified);
    }

    /**
     * @dev Slash a validator for misbehavior
     * @param validator Validator to slash
     * @param slashingType Type of violation
     * @param evidenceId Evidence identifier (if required)
     * @param customAmount Custom slashing amount (0 to use default)
     */
    function slashValidator(
        address validator,
        SlashingType slashingType,
        bytes32 evidenceId,
        uint256 customAmount
    ) external onlyRole(SLASHER_ROLE) nonReentrant whenNotPaused {
        if (validator == address(0)) revert InvalidValidatorAddress();
        
        SlashingConfig memory config = slashingConfigs[slashingType];
        
        // Check evidence requirements
        if (config.requiresEvidence) {
            if (evidenceId == bytes32(0)) revert InvalidEvidenceHash();
            SlashingEvidence memory evidence = evidenceRecords[evidenceId];
            if (evidence.submitter == address(0)) revert InvalidEvidenceData();
            if (!evidence.verified) revert EvidenceNotVerified();
            if (block.timestamp > evidence.timestamp + config.evidenceTimeout) {
                revert InvalidEvidenceData();
            }
        }
        
        // Get validator stake (this would interface with validator manager)
        uint256 validatorStake = _getValidatorStake(validator);
        if (validatorStake < minStakeForSlashing) revert InsufficientStake();
        
        // Calculate slashing amount
        uint256 slashingAmount;
        if (customAmount > 0) {
            if (customAmount > (validatorStake * maxSlashingPercentage) / 10000) {
                revert InvalidPenaltyPercentage();
            }
            slashingAmount = customAmount;
        } else {
            slashingAmount = (validatorStake * config.penaltyPercentage) / 10000;
        }
        
        // Execute slashing
        _executeSlashing(validator, slashingType, slashingAmount, evidenceId);
        
        // Jail validator if required
        if (config.jailDuration > 0) {
            _jailValidator(validator, slashingType, config.jailDuration);
        }
        
        // Update statistics
        slashingCounts[slashingType]++;
        validatorSlashingCounts[validator]++;
        totalSlashedAmount += slashingAmount;
    }

    /**
     * @dev Execute the slashing operation
     * @param validator Validator to slash
     * @param slashingType Type of violation
     * @param amount Amount to slash
     * @param evidenceId Evidence identifier
     */
    function _executeSlashing(
        address validator,
        SlashingType slashingType,
        uint256 amount,
        bytes32 evidenceId
    ) internal {
        // Transfer slashed tokens to treasury
        // Note: This assumes the validator manager handles the actual token transfer
        // In practice, this would call the validator manager to slash the stake
        
        // Create slashing record
        SlashingRecord memory record = SlashingRecord({
            validator: validator,
            slashingType: slashingType,
            amount: amount,
            timestamp: block.timestamp,
            evidenceHash: evidenceId,
            appealed: false,
            resolved: false
        });
        
        uint256 recordId = totalSlashingRecords++;
        slashingRecords[recordId] = record;
        validatorSlashings[validator].push(record);
        
        // Update statistics
        totalSlashedAmount += amount;
        slashingCounts[slashingType]++;
        validatorSlashingCounts[validator]++;
        
        emit ValidatorSlashed(validator, slashingType, amount, evidenceId);
    }

    /**
     * @dev Jail a validator
     * @param validator Validator to jail
     * @param reason Reason for jailing
     * @param duration Duration of jailing
     */
    function _jailValidator(
        address validator,
        SlashingType reason,
        uint256 duration
    ) internal {
        uint256 releaseTime = block.timestamp + duration;
        
        jailInfo[validator] = JailInfo({
            isJailed: true,
            jailStartTime: block.timestamp,
            jailDuration: duration,
            releaseTime: releaseTime,
            reason: reason
        });
        
        emit ValidatorJailed(validator, reason, duration, releaseTime);
    }

    /**
     * @dev Unjail a validator (can be called after jail period expires)
     * @param validator Validator to unjail
     */
    function unjailValidator(address validator) external {
        if (validator == address(0)) revert InvalidValidatorAddress();
        if (!jailInfo[validator].isJailed) revert ValidatorNotJailed();
        if (block.timestamp < jailInfo[validator].releaseTime) revert JailPeriodNotExpired();
        
        jailInfo[validator].isJailed = false;
        emit ValidatorUnjailed(validator, block.timestamp);
    }

    /**
     * @dev Appeal a slashing decision
     * @param recordId Slashing record ID
     */
    function appealSlashing(uint256 recordId) external {
        if (recordId >= totalSlashingRecords) revert InvalidRecordId();
        SlashingRecord storage record = slashingRecords[recordId];
        if (record.validator != msg.sender) revert NotYourSlashingRecord();
        if (record.appealed) revert AlreadyAppealed();
        if (record.resolved) revert AlreadyResolved();
        if (block.timestamp > record.timestamp + appealWindow) revert AppealPeriodExpired();
        
        record.appealed = true;
        appeals[msg.sender][recordId] = true;
        appealCounts[msg.sender]++;
        
        emit SlashingAppealed(msg.sender, recordId, block.timestamp);
    }

    /**
     * @dev Update slashing configuration
     * @param slashingType Type of violation
     * @param penaltyPercentage Penalty percentage (basis points)
     * @param jailDuration Jail duration in seconds
     * @param requiresEvidence Whether evidence is required
     * @param evidenceTimeout Evidence submission timeout
     * @param severity Severity level
     */
    function updateSlashingConfig(
        SlashingType slashingType,
        uint256 penaltyPercentage,
        uint256 jailDuration,
        bool requiresEvidence,
        uint256 evidenceTimeout,
        SlashingSeverity severity
    ) external onlyRole(ADMIN_ROLE) {
        if (penaltyPercentage > maxSlashingPercentage) revert PenaltyTooHigh();
        
        slashingConfigs[slashingType] = SlashingConfig({
            penaltyPercentage: penaltyPercentage,
            jailDuration: jailDuration,
            requiresEvidence: requiresEvidence,
            evidenceTimeout: evidenceTimeout,
            severity: severity
        });
        
        emit SlashingConfigUpdated(
            slashingType,
            penaltyPercentage,
            jailDuration,
            severity
        );
    }

    /**
     * @dev Get validator stake (placeholder - would interface with validator manager)
     * @param validator Validator address
     * @return stake Validator stake amount
     */
    function _getValidatorStake(address validator) internal pure returns (uint256) {
        // This is a placeholder - in practice, this would call the validator manager
        // to get the actual stake amount
        validator; // Silence unused parameter warning
        return 10000e18; // Placeholder value
    }

    /**
     * @dev Check if validator is jailed
     * @param validator Validator address
     * @return isJailed Whether validator is jailed
     */
    function isValidatorJailed(address validator) external view returns (bool) {
        return jailInfo[validator].isJailed && block.timestamp < jailInfo[validator].releaseTime;
    }

    /**
     * @dev Get validator slashing history
     * @param validator Validator address
     * @return records Array of slashing records
     */
    function getValidatorSlashingHistory(address validator) external view returns (SlashingRecord[] memory) {
        return validatorSlashings[validator];
    }

    /**
     * @dev Get slashing statistics for a specific validator
     * @param validatorAddress Address of the validator
     * @return totalSlashings Total number of slashings for this validator
     * @return totalPenalty Total amount slashed for this validator
     * @return currentJailEndTime Timestamp when jail period ends (if jailed)
     * @return isCurrentlyJailed Whether the validator is currently jailed
     * @return appealCount Number of appeals submitted by this validator
     */
    function getSlashingStatistics(address validatorAddress) external view returns (
        uint256 totalSlashings,
        uint256 totalPenalty,
        uint256 currentJailEndTime,
        bool isCurrentlyJailed,
        uint256 appealCount
    ) {
        totalSlashings = validatorSlashingCounts[validatorAddress];
        
        // Calculate total penalty for this validator
        SlashingRecord[] storage records = validatorSlashings[validatorAddress];
        totalPenalty = 0;
        for (uint256 i = 0; i < records.length; i++) {
            totalPenalty += records[i].amount;
        }
        
        JailInfo storage jail = jailInfo[validatorAddress];
        currentJailEndTime = jail.releaseTime;
        isCurrentlyJailed = jail.isJailed && block.timestamp < jail.releaseTime;
        appealCount = appealCounts[validatorAddress];
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
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(ADMIN_ROLE) {
        // Authorization handled by onlyRole modifier
    }
}