// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./SmartChequeEscrow.sol";

/**
 * @title DisputeManager
 * @dev Manages dispute resolution process for Smart Cheques
 */
contract DisputeManager is 
    Initializable, 
    AccessControlUpgradeable, 
    PausableUpgradeable, 
    UUPSUpgradeable 
{
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant ARBITRATOR_ROLE = keccak256("ARBITRATOR_ROLE");

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
        address arbitrator;
        uint256 createdAt;
        uint256 resolvedAt;
    }

    // Mapping from dispute ID to Dispute
    mapping(bytes32 => Dispute) public disputes;
    
    // Mapping from cheque address to array of dispute IDs
    mapping(address => bytes32[]) public chequeDisputes;

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

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() public initializer {
        __AccessControl_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);

        // Set default timeframes
        reviewPeriod = 2 days;
        resolutionPeriod = 5 days;
        escalationPeriod = 7 days;
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
        require(chequeContract != address(0), "Invalid cheque contract");
        
        SmartChequeEscrow cheque = SmartChequeEscrow(chequeContract);
        require(
            msg.sender == cheque.buyer() || msg.sender == cheque.seller(),
            "Only buyer or seller can open dispute"
        );

        bytes32 disputeId = keccak256(
            abi.encodePacked(
                chequeContract,
                milestoneIndex,
                msg.sender,
                block.timestamp
            )
        );

        require(disputes[disputeId].status == DisputeStatus.None, "Dispute already exists");

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
            createdAt: block.timestamp,
            resolvedAt: 0
        });

        chequeDisputes[chequeContract].push(disputeId);

        emit DisputeOpened(disputeId, chequeContract, milestoneIndex, msg.sender);

        return disputeId;
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
        require(dispute.status == DisputeStatus.UnderReview, "Invalid dispute status");
        require(dispute.arbitrator == msg.sender, "Not assigned arbitrator");

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
    ) external onlyRole(ARBITRATOR_ROLE) whenNotPaused {
        Dispute storage dispute = disputes[disputeId];
        require(dispute.status == DisputeStatus.ResolutionProposed, "Invalid dispute status");
        require(dispute.arbitrator == msg.sender, "Not assigned arbitrator");

        SmartChequeEscrow cheque = SmartChequeEscrow(dispute.chequeContract);

        if (dispute.proposedResolution == ResolutionType.ReleaseFunds) {
            cheque.resolveDispute(dispute.milestoneIndex, true);
        } else if (dispute.proposedResolution == ResolutionType.RefundBuyer) {
            cheque.resolveDispute(dispute.milestoneIndex, false);
        } else if (dispute.proposedResolution == ResolutionType.PartialRelease) {
            // TODO: Implement partial release logic
        }

        dispute.status = DisputeStatus.Resolved;
        dispute.resolvedAt = block.timestamp;

        emit DisputeResolved(
            disputeId,
            dispute.proposedResolution,
            dispute.proposedAmount
        );
    }

    /**
     * @dev Escalates a dispute to an arbitrator
     * @param disputeId ID of the dispute
     * @param arbitrator Address of the arbitrator
     */
    function escalateDispute(
        bytes32 disputeId,
        address arbitrator
    ) external whenNotPaused {
        Dispute storage dispute = disputes[disputeId];
        require(dispute.status == DisputeStatus.Opened, "Invalid dispute status");
        require(hasRole(ARBITRATOR_ROLE, arbitrator), "Invalid arbitrator");

        dispute.arbitrator = arbitrator;
        dispute.status = DisputeStatus.UnderReview;

        emit DisputeStatusUpdated(disputeId, DisputeStatus.UnderReview);
        emit DisputeEscalated(disputeId, arbitrator);
    }

    /**
     * @dev Returns dispute details
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
     * @dev Function that should revert when msg.sender is not authorized to upgrade the contract
     */
    function _authorizeUpgrade(address) internal override onlyRole(ADMIN_ROLE) {}
}