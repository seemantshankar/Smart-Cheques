// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

/**
 * @title SmartChequeEscrow
 * @dev Manages escrow funds and milestone states for Smart Cheques
 */
contract SmartChequeEscrow is 
    Initializable, 
    ReentrancyGuardUpgradeable 
{
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct Milestone {
        uint256 amount;
        bytes32 obligationHash;
        bool isCompleted;
        bool isDisputed;
    }

    address public buyer;
    address public seller;
    uint256 public totalAmount;
    IERC20Upgradeable public token;
    
    Milestone[] public milestones;
    
    bool public isLocked;
    bool public isFinalized;

    event FundsLocked(address indexed buyer, uint256 amount);
    event MilestoneCompleted(uint256 indexed milestoneIndex, uint256 amount);
    event DisputeRaised(uint256 indexed milestoneIndex, address initiator);
    event DisputeResolved(uint256 indexed milestoneIndex, bool releaseFunds);
    event FundsReleased(address indexed seller, uint256 amount);
    event FundsRefunded(address indexed buyer, uint256 amount);

    modifier onlyBuyer() {
        require(msg.sender == buyer, "Only buyer can call this");
        _;
    }

    modifier notFinalized() {
        require(!isFinalized, "Contract is finalized");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _buyer,
        address _seller,
        uint256 _totalAmount,
        uint256[] memory _milestoneAmounts,
        bytes32[] memory _obligations
    ) public initializer {
        __ReentrancyGuard_init();

        buyer = _buyer;
        seller = _seller;
        totalAmount = _totalAmount;
        
        for (uint256 i = 0; i < _milestoneAmounts.length; i++) {
            milestones.push(
                Milestone({
                    amount: _milestoneAmounts[i],
                    obligationHash: _obligations[i],
                    isCompleted: false,
                    isDisputed: false
                })
            );
        }

        isLocked = false;
        isFinalized = false;
    }

    /**
     * @dev Locks funds in the contract
     * @param _token The ERC20 token to be used
     */
    function lockFunds(address _token) external onlyBuyer nonReentrant {
        require(!isLocked, "Funds already locked");
        require(_token != address(0), "Invalid token address");

        token = IERC20Upgradeable(_token);
        
        // Transfer tokens from buyer to contract
        token.safeTransferFrom(buyer, address(this), totalAmount);
        
        isLocked = true;
        emit FundsLocked(buyer, totalAmount);
    }

    /**
     * @dev Completes a milestone and releases funds to seller
     * @param milestoneIndex Index of the milestone
     * @param proof Proof of milestone completion
     */
    function completeMilestone(
        uint256 milestoneIndex,
        bytes calldata proof
    ) external nonReentrant notFinalized {
        require(isLocked, "Funds not locked");
        require(milestoneIndex < milestones.length, "Invalid milestone index");
        require(!milestones[milestoneIndex].isCompleted, "Milestone already completed");
        require(!milestones[milestoneIndex].isDisputed, "Milestone is disputed");

        // Verify milestone completion (to be implemented with oracle integration)
        require(_verifyMilestone(milestoneIndex, proof), "Invalid milestone proof");

        Milestone storage milestone = milestones[milestoneIndex];
        milestone.isCompleted = true;

        // Release funds for this milestone
        token.safeTransfer(seller, milestone.amount);

        emit MilestoneCompleted(milestoneIndex, milestone.amount);

        // Check if all milestones are completed
        bool allCompleted = true;
        for (uint256 i = 0; i < milestones.length; i++) {
            if (!milestones[i].isCompleted) {
                allCompleted = false;
                break;
            }
        }

        if (allCompleted) {
            isFinalized = true;
        }
    }

    /**
     * @dev Raises a dispute for a milestone
     * @param milestoneIndex Index of the milestone
     */
    function raiseDispute(
        uint256 milestoneIndex
    ) external nonReentrant notFinalized {
        require(msg.sender == buyer || msg.sender == seller, "Unauthorized");
        require(milestoneIndex < milestones.length, "Invalid milestone index");
        require(!milestones[milestoneIndex].isCompleted, "Milestone already completed");
        require(!milestones[milestoneIndex].isDisputed, "Dispute already raised");

        milestones[milestoneIndex].isDisputed = true;
        emit DisputeRaised(milestoneIndex, msg.sender);
    }

    /**
     * @dev Resolves a dispute
     * @param milestoneIndex Index of the milestone
     * @param releaseFunds Whether to release funds to seller
     */
    function resolveDispute(
        uint256 milestoneIndex,
        bool releaseFunds
    ) external nonReentrant notFinalized {
        // TODO: Add proper authorization for dispute resolution
        require(milestoneIndex < milestones.length, "Invalid milestone index");
        require(milestones[milestoneIndex].isDisputed, "No dispute raised");

        Milestone storage milestone = milestones[milestoneIndex];

        if (releaseFunds) {
            milestone.isCompleted = true;
            milestone.isDisputed = false;
            token.safeTransfer(seller, milestone.amount);
            emit FundsReleased(seller, milestone.amount);
        } else {
            milestone.isDisputed = false;
            token.safeTransfer(buyer, milestone.amount);
            emit FundsRefunded(buyer, milestone.amount);
        }

        emit DisputeResolved(milestoneIndex, releaseFunds);
    }

    /**
     * @dev Returns milestone details
     * @param index Index of the milestone
     */
    function getMilestone(uint256 index) external view returns (
        uint256 amount,
        bytes32 obligationHash,
        bool isCompleted,
        bool isDisputed
    ) {
        require(index < milestones.length, "Invalid milestone index");
        Milestone storage milestone = milestones[index];
        return (
            milestone.amount,
            milestone.obligationHash,
            milestone.isCompleted,
            milestone.isDisputed
        );
    }

    /**
     * @dev Returns the number of milestones
     */
    function getMilestoneCount() external view returns (uint256) {
        return milestones.length;
    }

    /**
     * @dev Internal function to verify milestone completion
     * @param milestoneIndex Index of the milestone
     * @param proof Proof of milestone completion
     */
    function _verifyMilestone(
        uint256 milestoneIndex,
        bytes calldata proof
    ) internal view returns (bool) {
        // TODO: Implement verification logic with oracle integration
        return true;
    }
}