// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title SimpleEscrow
 * @dev Simple escrow contract for testing without upgradeable pattern
 */
contract SimpleEscrow is ReentrancyGuard, AccessControl, Pausable {
    using SafeERC20 for IERC20;

    bytes32 public constant DISPUTE_RESOLVER_ROLE = keccak256("DISPUTE_RESOLVER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    struct Milestone {
        uint256 amount;
        bytes32 obligationHash;
        bool isCompleted;
        bool isDisputed;
    }

    address public buyer;
    address public seller;
    uint256 public totalAmount;
    IERC20 public token;
    Milestone[] public milestones;
    bool public isLocked;
    bool public isFinalized;
    uint256 public milestoneTimelock;
    mapping(uint256 => uint256) public milestoneCompletionTime;

    event FundsLocked(address indexed token, uint256 amount);
    event MilestoneCompleted(uint256 indexed milestoneIndex, uint256 amount);
    event DisputeRaised(uint256 indexed milestoneIndex, address indexed initiator);
    event DisputeResolved(uint256 indexed milestoneIndex, bool releaseFunds);
    event FundsReleased(address indexed recipient, uint256 amount);
    event FundsRefunded(address indexed recipient, uint256 amount);

    modifier onlyBuyer() {
        require(msg.sender == buyer, "Only buyer can call this");
        _;
    }

    modifier onlySeller() {
        require(msg.sender == seller, "Only seller can call this");
        _;
    }

    modifier onlyParties() {
        require(msg.sender == buyer || msg.sender == seller, "Only buyer or seller");
        _;
    }

    modifier notFinalized() {
        require(!isFinalized, "Contract is finalized");
        _;
    }

    constructor(
        address _buyer,
        address _seller,
        uint256 _totalAmount,
        uint256[] memory _milestoneAmounts,
        bytes32[] memory _obligations,
        address _admin,
        uint256 _milestoneTimelock
    ) {
        require(_buyer != address(0), "Invalid buyer address");
        require(_seller != address(0), "Invalid seller address");
        require(_buyer != _seller, "Buyer and seller cannot be the same");
        require(_totalAmount > 0, "Total amount must be greater than 0");
        require(_milestoneAmounts.length > 0, "At least one milestone required");
        require(_milestoneAmounts.length == _obligations.length, "Milestone amounts and obligations length mismatch");

        buyer = _buyer;
        seller = _seller;
        totalAmount = _totalAmount;
        milestoneTimelock = _milestoneTimelock;

        uint256 sum = 0;
        for (uint256 i = 0; i < _milestoneAmounts.length; i++) {
            require(_milestoneAmounts[i] > 0, "Milestone amount must be greater than 0");
            milestones.push(Milestone({
                amount: _milestoneAmounts[i],
                obligationHash: _obligations[i],
                isCompleted: false,
                isDisputed: false
            }));
            sum += _milestoneAmounts[i];
        }
        require(sum == _totalAmount, "Sum of milestone amounts must equal total amount");

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(DISPUTE_RESOLVER_ROLE, _admin);
        _grantRole(PAUSER_ROLE, _admin);
    }

    function lockFunds(address _token, uint256 _amount) external onlyBuyer nonReentrant notFinalized whenNotPaused {
        require(!isLocked, "Funds already locked");
        require(_token != address(0), "Invalid token address");
        require(_amount == totalAmount, "Amount must equal total amount");

        token = IERC20(_token);
        token.safeTransferFrom(msg.sender, address(this), _amount);
        isLocked = true;

        emit FundsLocked(_token, _amount);
    }

    function completeMilestone(uint256 milestoneIndex, bytes calldata proof) external onlySeller nonReentrant notFinalized whenNotPaused {
        require(isLocked, "Funds not locked");
        require(milestoneIndex < milestones.length, "Invalid milestone index");
        require(!milestones[milestoneIndex].isCompleted, "Milestone already completed");
        require(!milestones[milestoneIndex].isDisputed, "Milestone is disputed");
        require(proof.length > 0, "Proof cannot be empty");

        milestoneCompletionTime[milestoneIndex] = block.timestamp;
    }

    function finalizeMilestone(uint256 milestoneIndex) external nonReentrant notFinalized whenNotPaused {
        require(isLocked, "Funds not locked");
        require(milestoneIndex < milestones.length, "Invalid milestone index");
        require(!milestones[milestoneIndex].isCompleted, "Milestone already completed");
        require(!milestones[milestoneIndex].isDisputed, "Milestone is disputed");
        require(milestoneCompletionTime[milestoneIndex] > 0, "Milestone not ready for finalization");
        require(
            block.timestamp >= milestoneCompletionTime[milestoneIndex] + milestoneTimelock,
            "Timelock period not elapsed"
        );

        Milestone storage milestone = milestones[milestoneIndex];
        milestone.isCompleted = true;

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

    function raiseDispute(uint256 milestoneIndex) external onlyParties nonReentrant notFinalized whenNotPaused {
        require(milestoneIndex < milestones.length, "Invalid milestone index");
        require(!milestones[milestoneIndex].isCompleted, "Milestone already completed");

        milestones[milestoneIndex].isDisputed = true;
        emit DisputeRaised(milestoneIndex, msg.sender);
    }

    function resolveDispute(uint256 milestoneIndex, bool releaseFunds) external onlyRole(DISPUTE_RESOLVER_ROLE) nonReentrant notFinalized whenNotPaused {
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

    function getMilestone(uint256 index) external view returns (
        uint256 amount,
        bytes32 obligationHash,
        bool isCompleted,
        bool isDisputed
    ) {
        require(index < milestones.length, "Invalid milestone index");
        Milestone storage milestone = milestones[index];
        return (milestone.amount, milestone.obligationHash, milestone.isCompleted, milestone.isDisputed);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}