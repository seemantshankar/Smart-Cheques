// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {SmartChequeEscrow} from "./SmartChequeEscrow.sol";

/**
 * @title DisputeManager
 * @dev Manages dispute resolution process for Smart Cheques
 */
contract DisputeManager is 
    Initializable, 
    AccessControlUpgradeable, 
    PausableUpgradeable, 
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable 
{
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant ARBITRATOR_ROLE = keccak256("ARBITRATOR_ROLE");
    bytes32 public constant PANEL_MANAGER_ROLE = keccak256("PANEL_MANAGER_ROLE");

    enum DisputeStatus { 
        None,
        Opened, 
        UnderReview, 
        ResolutionProposed, 
        Resolved, 
        Escalated 
    }

    enum ResolutionType { 
        None,
        ReleaseFunds, 
        RefundBuyer, 
        PartialRelease 
    }

    struct Dispute {
        address chequeContract;
        uint256 milestoneIndex;
        address initiator;
        string reason;
        bytes evidence;
        DisputeStatus status;
        ResolutionType proposedResolution;
        uint256 proposedAmount;
        address arbitrator; // Legacy field for backward compatibility
        address[] arbitratorPanel;
        uint256 requiredVotes;
        uint256 createdAt;
        uint256 resolvedAt;
    }

    struct ArbitratorVote {
        ResolutionType resolutionType;
        uint256 amount;
        bool hasVoted;
    }

    struct PanelConfig {
        address[] arbitrators;
        uint256 threshold; // Minimum votes required for resolution
        bool isActive;
    }

    // Mapping from dispute ID to Dispute
    mapping(bytes32 => Dispute) public disputes;
    
    // Mapping from cheque address to array of dispute IDs
    mapping(address => bytes32[]) public chequeDisputes;
    
    // Multi-arbitrator panel mappings
    mapping(bytes32 => mapping(address => ArbitratorVote)) public disputeVotes;
    mapping(bytes32 => mapping(ResolutionType => uint256)) public resolutionVoteCounts;
    mapping(bytes32 => mapping(ResolutionType => uint256)) public resolutionAmountSum;
    
    // Panel configurations
    mapping(bytes32 => PanelConfig) public panelConfigs;
    bytes32[] public activePanels;
    address[] public registeredArbitrators;
    
    // Default panel settings
    uint256 public defaultPanelSize;
    uint256 public defaultThreshold;

    // Dispute resolution timeframes
    uint256 public reviewPeriod;
    uint256 public resolutionPeriod;
    uint256 public escalationPeriod;

    event DisputeOpened(
        bytes32 indexed disputeId,
        address indexed chequeContract,
        uint256 milestoneIndex,
        address initiator
    );

    event DisputeStatusUpdated(
        bytes32 indexed disputeId,
        DisputeStatus newStatus
    );

    event ResolutionProposed(
        bytes32 indexed disputeId,
        ResolutionType resolutionType,
        uint256 amount
    );

    event DisputeResolved(
        bytes32 indexed disputeId,
        ResolutionType resolution,
        uint256 amount
    );

    event DisputeEscalated(
        bytes32 indexed disputeId,
        address arbitrator
    );

    event PanelAssigned(
        bytes32 indexed disputeId,
        address[] arbitrators,
        uint256 requiredVotes
    );

    event ArbitratorVoteSubmitted(
        bytes32 indexed disputeId,
        address indexed arbitrator,
        ResolutionType resolutionType,
        uint256 amount
    );

    event PanelConfigured(
        bytes32 indexed panelId,
        address[] arbitrators,
        uint256 threshold
    );

    event QuorumReached(
        bytes32 indexed disputeId,
        ResolutionType winningResolution,
        uint256 averageAmount
    );

    // Custom Errors
    error InvalidChequeContract();
    error OnlyParticipantAllowed();
    error DisputeAlreadyExists();
    error InvalidDisputeStatus();
    error NotAssignedArbitrator();
    error InvalidArbitrator();
    error OnlyBuyerOrSeller();
    error NotArbitratorRole();
    error PanelNotActive();
    error InvalidPanelConfiguration();
    error NoPanelAssigned();
    error NotInAssignedPanel();
    error AlreadyVoted();
    error InvalidAmount();
    error ThresholdTooHigh();
    error ThresholdMustBePositive();
    error InvalidArbitratorRole();
    error InsufficientArbitrators();

    /// @custom:oz-upgrades-unsafe-allow constructor
    // solhint-disable-next-line func-visibility
    constructor() {
        _disableInitializers();
    }

    function initialize(address _admin, address _arbitrator, address _panelManager) external initializer {
        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
        _grantRole(PANEL_MANAGER_ROLE, _panelManager);
        _grantRole(ARBITRATOR_ROLE, _arbitrator);

        // Set default timeframes
        reviewPeriod = 2 days;
        resolutionPeriod = 5 days;
        escalationPeriod = 7 days;
        
        // Set default panel settings
        defaultPanelSize = 3;
        defaultThreshold = 2; // Majority voting
    }

    function registerArbitrators(address[] calldata arbitrators) external onlyRole(PANEL_MANAGER_ROLE) {
        for (uint256 i = 0; i < arbitrators.length; i++) {
            address arb = arbitrators[i];
            if (!hasRole(ARBITRATOR_ROLE, arb)) revert InvalidArbitratorRole();
            registeredArbitrators.push(arb);
        }
    }

    function getRegisteredArbitrators() external view returns (address[] memory) {
        return registeredArbitrators;
    }

    /**
     * @dev Opens a new dispute
     * @param chequeContract Address of the Smart Cheque contract
     * @param milestoneIndex Index of the disputed milestone
     * @param reason Reason for the dispute
     * @param evidence Evidence supporting the dispute
     */
    function openDispute(
        address chequeContract,
        uint256 milestoneIndex,
        string calldata reason,
        bytes calldata evidence
    ) external whenNotPaused returns (bytes32) {
        if (chequeContract == address(0)) revert InvalidChequeContract();
        
        SmartChequeEscrow cheque = SmartChequeEscrow(chequeContract);
        if (msg.sender != cheque.buyer() && msg.sender != cheque.seller()) revert OnlyParticipantAllowed();

        bytes32 disputeId = keccak256(
            abi.encodePacked(
                chequeContract,
                milestoneIndex,
                msg.sender,
                block.timestamp
            )
        );

        if (disputes[disputeId].status != DisputeStatus.None) revert DisputeAlreadyExists();

        disputes[disputeId] = Dispute({
            chequeContract: chequeContract,
            milestoneIndex: milestoneIndex,
            initiator: msg.sender,
            reason: reason,
            evidence: evidence,
            status: DisputeStatus.Opened,
            proposedResolution: ResolutionType.None,
            proposedAmount: 0,
            arbitrator: address(0),
            arbitratorPanel: new address[](0),
            requiredVotes: 0,
            createdAt: block.timestamp,
            resolvedAt: 0
        });

        chequeDisputes[chequeContract].push(disputeId);

        emit DisputeOpened(disputeId, chequeContract, milestoneIndex, msg.sender);

        return disputeId;
    }

    modifier onlyParticipant(address chequeContract) {
        SmartChequeEscrow cheque = SmartChequeEscrow(chequeContract);
        if (msg.sender != cheque.buyer() && msg.sender != cheque.seller()) revert OnlyBuyerOrSeller();
        _;
    }

    /**
     * @dev Proposes a resolution for a dispute
     * @param disputeId ID of the dispute
     * @param resolutionType Type of proposed resolution
     * @param amount Amount for partial release (if applicable)
     */
    function proposeResolution(
        bytes32 disputeId,
        ResolutionType resolutionType,
        uint256 amount
    ) external onlyRole(ARBITRATOR_ROLE) whenNotPaused {
        Dispute storage dispute = disputes[disputeId];
        if (dispute.status != DisputeStatus.UnderReview) revert InvalidDisputeStatus();
        if (dispute.arbitrator != msg.sender) revert NotAssignedArbitrator();

        dispute.proposedResolution = resolutionType;
        dispute.proposedAmount = amount;
        dispute.status = DisputeStatus.ResolutionProposed;

        emit ResolutionProposed(disputeId, resolutionType, amount);
    }

    /**
     * @dev Resolves a dispute
     * @param disputeId ID of the dispute
     */
    function resolveDispute(
        bytes32 disputeId
    ) external onlyRole(ARBITRATOR_ROLE) whenNotPaused nonReentrant {
        Dispute storage dispute = disputes[disputeId];
        if (dispute.status != DisputeStatus.ResolutionProposed) revert InvalidDisputeStatus();
        if (dispute.arbitrator != msg.sender) revert NotAssignedArbitrator();

        // Update state before external calls (CEI pattern)
        dispute.status = DisputeStatus.Resolved;
        dispute.resolvedAt = block.timestamp;

        // External interactions after state changes
        SmartChequeEscrow cheque = SmartChequeEscrow(dispute.chequeContract);

        if (dispute.proposedResolution == ResolutionType.ReleaseFunds) {
            cheque.resolveDispute(dispute.milestoneIndex, true);
        } else if (dispute.proposedResolution == ResolutionType.RefundBuyer) {
            cheque.resolveDispute(dispute.milestoneIndex, false);
        } else if (dispute.proposedResolution == ResolutionType.PartialRelease) {
            cheque.resolvePartialRelease(dispute.milestoneIndex, dispute.proposedAmount);
        }

        emit DisputeResolved(
            disputeId,
            dispute.proposedResolution,
            dispute.proposedAmount
        );
    }

    /**
     * @dev Escalates a dispute to an arbitrator (legacy single arbitrator)
     * @param disputeId ID of the dispute
     * @param arbitrator Address of the arbitrator
     */
    function escalateDispute(
        bytes32 disputeId,
        address arbitrator
    ) external whenNotPaused nonReentrant onlyParticipant(disputes[disputeId].chequeContract) {
        Dispute storage dispute = disputes[disputeId];
        if (dispute.status != DisputeStatus.Opened) revert InvalidDisputeStatus();
        if (!hasRole(ARBITRATOR_ROLE, arbitrator)) revert InvalidArbitrator();

        dispute.arbitrator = arbitrator;
        dispute.status = DisputeStatus.UnderReview;

        emit DisputeStatusUpdated(disputeId, DisputeStatus.UnderReview);
        emit DisputeEscalated(disputeId, arbitrator);
    }

    /**
     * @dev Escalates a dispute to a multi-arbitrator panel
     * @param disputeId ID of the dispute
     * @param panelId ID of the pre-configured panel, or bytes32(0) for auto-assignment
     */
    function escalateDisputeToPanel(
        bytes32 disputeId,
        bytes32 panelId
    ) external whenNotPaused nonReentrant onlyParticipant(disputes[disputeId].chequeContract) {
        Dispute storage dispute = disputes[disputeId];
        if (dispute.status != DisputeStatus.Opened) revert InvalidDisputeStatus();
        
        address[] memory panel;
        uint256 threshold;
        
        if (panelId == bytes32(0)) {
            // Auto-assign from available arbitrators
            (panel, threshold) = _selectRandomPanel();
        } else {
            // Use pre-configured panel
            PanelConfig storage config = panelConfigs[panelId];
            if (!config.isActive) revert InvalidArbitrator();
            panel = config.arbitrators;
            threshold = config.threshold;
        }
        
        if (panel.length < threshold) revert InvalidArbitrator();
        
        dispute.arbitratorPanel = panel;
        dispute.requiredVotes = threshold;
        dispute.status = DisputeStatus.UnderReview;
        
        emit DisputeStatusUpdated(disputeId, DisputeStatus.UnderReview);
        emit PanelAssigned(disputeId, panel, threshold);
    }

    /**
     * @dev Submits a vote for dispute resolution (multi-arbitrator)
     * @param disputeId ID of the dispute
     * @param resolutionType Type of proposed resolution
     * @param amount Amount for partial release (if applicable)
     */
    function submitArbitratorVote(
        bytes32 disputeId,
        ResolutionType resolutionType,
        uint256 amount
    ) external onlyRole(ARBITRATOR_ROLE) whenNotPaused {
        Dispute storage dispute = disputes[disputeId];
        if (dispute.status != DisputeStatus.UnderReview) revert InvalidDisputeStatus();
        if (dispute.arbitratorPanel.length == 0) revert NoPanelAssigned();
        if (!_isArbitratorInPanel(disputeId, msg.sender)) revert NotInAssignedPanel();
        if (disputeVotes[disputeId][msg.sender].hasVoted) revert AlreadyVoted();
        if (resolutionType == ResolutionType.PartialRelease) {
            (uint256 milestoneAmount,,,) = SmartChequeEscrow(dispute.chequeContract).getMilestone(dispute.milestoneIndex);
            if (amount == 0 || amount > milestoneAmount) revert InvalidAmount();
        }
        
        // Record the vote
        disputeVotes[disputeId][msg.sender] = ArbitratorVote({
            resolutionType: resolutionType,
            amount: amount,
            hasVoted: true
        });
        
        // Update vote counts
        resolutionVoteCounts[disputeId][resolutionType]++;
        resolutionAmountSum[disputeId][resolutionType] += amount;
        
        emit ArbitratorVoteSubmitted(disputeId, msg.sender, resolutionType, amount);
        
        // Check if quorum is reached
        if (resolutionVoteCounts[disputeId][resolutionType] >= dispute.requiredVotes) {
            _finalizeDisputeResolution(disputeId, resolutionType);
        }
    }

    /**
     * @dev Configures a new arbitrator panel
     * @param panelId Unique identifier for the panel
     * @param arbitrators Array of arbitrator addresses
     * @param threshold Minimum votes required for resolution
     */
    function configurePanelArbitrators(
        bytes32 panelId,
        address[] calldata arbitrators,
        uint256 threshold
    ) external onlyRole(PANEL_MANAGER_ROLE) {
        if (arbitrators.length < threshold) revert ThresholdTooHigh();
        if (threshold == 0) revert ThresholdMustBePositive();
        
        // Verify all addresses have ARBITRATOR_ROLE
        for (uint256 i = 0; i < arbitrators.length; i++) {
            if (!hasRole(ARBITRATOR_ROLE, arbitrators[i])) revert InvalidArbitratorRole();
        }
        
        PanelConfig storage config = panelConfigs[panelId];
        
        // If this is a new panel, add to active panels
        if (!config.isActive) {
            activePanels.push(panelId);
        }
        
        config.arbitrators = arbitrators;
        config.threshold = threshold;
        config.isActive = true;
        
        emit PanelConfigured(panelId, arbitrators, threshold);
    }

    /**
     * @dev Deactivates an arbitrator panel
     * @param panelId ID of the panel to deactivate
     */
    function deactivatePanel(bytes32 panelId) external onlyRole(PANEL_MANAGER_ROLE) {
        panelConfigs[panelId].isActive = false;
        
        // Remove from active panels array
        for (uint256 i = 0; i < activePanels.length; i++) {
            if (activePanels[i] == panelId) {
                activePanels[i] = activePanels[activePanels.length - 1];
                activePanels.pop();
                break;
            }
        }
    }

    /**
     * @dev Updates default panel settings
     * @param newPanelSize Default number of arbitrators in auto-assigned panels
     * @param newThreshold Default threshold for auto-assigned panels
     */
    function updateDefaultPanelSettings(
        uint256 newPanelSize,
        uint256 newThreshold
    ) external onlyRole(ADMIN_ROLE) {
        if (newPanelSize < newThreshold) revert ThresholdTooHigh();
        if (newThreshold == 0) revert ThresholdMustBePositive();
        
        defaultPanelSize = newPanelSize;
        defaultThreshold = newThreshold;
    }

    /**
     * @dev Returns dispute details (legacy function for backward compatibility)
     * @param disputeId ID of the dispute
     */
    function getDispute(bytes32 disputeId) external view returns (
        address chequeContract,
        uint256 milestoneIndex,
        address initiator,
        string memory reason,
        DisputeStatus status,
        ResolutionType proposedResolution,
        uint256 proposedAmount,
        address arbitrator,
        uint256 createdAt,
        uint256 resolvedAt
    ) {
        Dispute storage dispute = disputes[disputeId];
        return (
            dispute.chequeContract,
            dispute.milestoneIndex,
            dispute.initiator,
            dispute.reason,
            dispute.status,
            dispute.proposedResolution,
            dispute.proposedAmount,
            dispute.arbitrator,
            dispute.createdAt,
            dispute.resolvedAt
        );
    }

    /**
     * @dev Returns complete dispute details including multi-arbitrator information
     * @param disputeId ID of the dispute
     */
    function getDisputeDetails(bytes32 disputeId) external view returns (
        address chequeContract,
        uint256 milestoneIndex,
        address initiator,
        string memory reason,
        DisputeStatus status,
        ResolutionType proposedResolution,
        uint256 proposedAmount,
        address arbitrator,
        address[] memory arbitratorPanel,
        uint256 requiredVotes,
        uint256 createdAt,
        uint256 resolvedAt
    ) {
        Dispute storage dispute = disputes[disputeId];
        return (
            dispute.chequeContract,
            dispute.milestoneIndex,
            dispute.initiator,
            dispute.reason,
            dispute.status,
            dispute.proposedResolution,
            dispute.proposedAmount,
            dispute.arbitrator,
            dispute.arbitratorPanel,
            dispute.requiredVotes,
            dispute.createdAt,
            dispute.resolvedAt
        );
    }

    /**
     * @dev Returns all dispute IDs for a cheque
     * @param chequeContract Address of the cheque contract
     */
    function getChequeDisputes(address chequeContract) external view returns (bytes32[] memory) {
        return chequeDisputes[chequeContract];
    }

    /**
     * @dev Updates dispute resolution timeframes
     * @param newReviewPeriod New review period in seconds
     * @param newResolutionPeriod New resolution period in seconds
     * @param newEscalationPeriod New escalation period in seconds
     */
    function updateTimeframes(
        uint256 newReviewPeriod,
        uint256 newResolutionPeriod,
        uint256 newEscalationPeriod
    ) external onlyRole(ADMIN_ROLE) {
        reviewPeriod = newReviewPeriod;
        resolutionPeriod = newResolutionPeriod;
        escalationPeriod = newEscalationPeriod;
    }

    /**
     * @dev Pauses the contract
     */
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    /**
     * @dev Unpauses the contract
     */
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    /**
     * @dev Returns panel configuration
     * @param panelId ID of the panel
     */
    function getPanelConfig(bytes32 panelId) external view returns (
        address[] memory arbitrators,
        uint256 threshold,
        bool isActive
    ) {
        PanelConfig storage config = panelConfigs[panelId];
        return (config.arbitrators, config.threshold, config.isActive);
    }

    /**
     * @dev Returns all active panel IDs
     */
    function getActivePanels() external view returns (bytes32[] memory) {
        return activePanels;
    }

    /**
     * @dev Returns vote information for a dispute and arbitrator
     * @param disputeId ID of the dispute
     * @param arbitrator Address of the arbitrator
     */
    function getArbitratorVote(bytes32 disputeId, address arbitrator) external view returns (
        ResolutionType resolutionType,
        uint256 amount,
        bool hasVoted
    ) {
        ArbitratorVote storage vote = disputeVotes[disputeId][arbitrator];
        return (vote.resolutionType, vote.amount, vote.hasVoted);
    }

    /**
     * @dev Returns vote counts for a dispute
     * @param disputeId ID of the dispute
     */
    function getDisputeVoteCounts(bytes32 disputeId) external view returns (
        uint256 releaseFundsVotes,
        uint256 refundBuyerVotes,
        uint256 partialReleaseVotes
    ) {
        return (
            resolutionVoteCounts[disputeId][ResolutionType.ReleaseFunds],
            resolutionVoteCounts[disputeId][ResolutionType.RefundBuyer],
            resolutionVoteCounts[disputeId][ResolutionType.PartialRelease]
        );
    }

    /**
     * @dev Returns the arbitrator panel for a dispute
     * @param disputeId ID of the dispute
     */
    function getDisputePanel(bytes32 disputeId) external view returns (
        address[] memory arbitrators,
        uint256 requiredVotes
    ) {
        Dispute storage dispute = disputes[disputeId];
        return (dispute.arbitratorPanel, dispute.requiredVotes);
    }

    // Internal helper functions

    /**
     * @dev Checks if an arbitrator is in the assigned panel for a dispute
     * @param disputeId ID of the dispute
     * @param arbitrator Address of the arbitrator
     */
    function _isArbitratorInPanel(bytes32 disputeId, address arbitrator) internal view returns (bool) {
        address[] storage panel = disputes[disputeId].arbitratorPanel;
        for (uint256 i = 0; i < panel.length; i++) {
            if (panel[i] == arbitrator) {
                return true;
            }
        }
        return false;
    }

    /**
     * @dev Selects a random panel from available arbitrators
     */
    function _selectRandomPanel() internal view returns (address[] memory, uint256) {
        uint256 n = registeredArbitrators.length;
        if (n < defaultPanelSize) revert InsufficientArbitrators();
        address[] memory panel = new address[](defaultPanelSize);
        uint256 seed = uint256(keccak256(abi.encodePacked(block.prevrandao, block.timestamp, n)));
        for (uint256 i = 0; i < defaultPanelSize; i++) {
            uint256 idx = uint256(keccak256(abi.encode(seed, i))) % n;
            panel[i] = registeredArbitrators[idx];
        }
        return (panel, defaultThreshold);
    }

    /**
     * @dev Finalizes dispute resolution when quorum is reached
     * @param disputeId ID of the dispute
     * @param winningResolution The resolution type that reached quorum
     */
    function _finalizeDisputeResolution(bytes32 disputeId, ResolutionType winningResolution) internal {
        Dispute storage dispute = disputes[disputeId];
        
        // Calculate average amount for the winning resolution
        uint256 totalAmount = resolutionAmountSum[disputeId][winningResolution];
        uint256 voteCount = resolutionVoteCounts[disputeId][winningResolution];
        uint256 averageAmount = voteCount > 0 ? totalAmount / voteCount : 0;
        
        // Update dispute state
        dispute.proposedResolution = winningResolution;
        dispute.proposedAmount = averageAmount;
        dispute.status = DisputeStatus.ResolutionProposed;
        
        emit QuorumReached(disputeId, winningResolution, averageAmount);
        emit ResolutionProposed(disputeId, winningResolution, averageAmount);
        
        // Auto-resolve the dispute
        _executeResolution(disputeId);
    }

    /**
     * @dev Executes the resolution for a dispute
     * @param disputeId ID of the dispute
     */
    function _executeResolution(bytes32 disputeId) internal {
        Dispute storage dispute = disputes[disputeId];
        
        // Update state before external calls (CEI pattern)
        dispute.status = DisputeStatus.Resolved;
        dispute.resolvedAt = block.timestamp;
        
        // External interactions after state changes
        SmartChequeEscrow cheque = SmartChequeEscrow(dispute.chequeContract);
        
        if (dispute.proposedResolution == ResolutionType.ReleaseFunds) {
            cheque.resolveDispute(dispute.milestoneIndex, true);
        } else if (dispute.proposedResolution == ResolutionType.RefundBuyer) {
            cheque.resolveDispute(dispute.milestoneIndex, false);
        } else if (dispute.proposedResolution == ResolutionType.PartialRelease) {
            cheque.resolvePartialRelease(dispute.milestoneIndex, dispute.proposedAmount);
        }
        
        emit DisputeResolved(
            disputeId,
            dispute.proposedResolution,
            dispute.proposedAmount
        );
    }

    /**
     * @dev Function that should revert when msg.sender is not authorized to upgrade the contract
     */
    function _authorizeUpgrade(address) internal override onlyRole(ADMIN_ROLE) {
        // UUPS upgrade authorization - only ADMIN_ROLE can upgrade
    }
}