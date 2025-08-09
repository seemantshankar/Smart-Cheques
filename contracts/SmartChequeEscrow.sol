// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {IERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import {SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {ECDSAUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/ECDSAUpgradeable.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {IObligationRegistry} from "./interfaces/IObligationRegistry.sol";

/**
 * @title SmartChequeEscrow
 * @dev Manages escrow funds and milestone states for Smart Cheques
 */
contract SmartChequeEscrow is 
    Initializable, 
    ReentrancyGuardUpgradeable,
    EIP712Upgradeable,
    AccessControlUpgradeable
{
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using ECDSAUpgradeable for bytes32;

    // Custom errors
    error InvalidMilestoneIndex();
    error FundsNotLocked();
    error OffChainSignedDisabled();
    error SignerNotSet();
    error AuthorizationExpired();
    error MilestoneAlreadyCompleted();
    error MilestoneDisputed();
    error InvalidRecipient();
    error InvalidSignature();
    error AuthorizationAlreadyUsed();
    error VerificationInProgress();
    error NoDisputeRaised();
    error AmountExceedsMilestone();
    error FundsAlreadyLocked();
    error InvalidTotalAmount();
    error DisputeAlreadyRaised();
    error AlreadyFinalized();
    error NotBuyerOrSeller();
    error OnlyBuyer();

    struct Milestone {
        uint256 amount;
        bytes32 obligationHash;
        bool isCompleted;
        bool isDisputed;
    }

    enum AuthorizationMode { None, OffChainSigned }

    address public buyer;
    address public seller;
    uint256 public totalAmount;
    IERC20Upgradeable public token;
    
    Milestone[] public milestones;
    
    bool public isLocked;
    bool public isFinalized;

    // Roles
    bytes32 public constant DISPUTE_MANAGER_ROLE = keccak256("DISPUTE_MANAGER_ROLE");

    // External integrations
    address public obligationRegistry;

    // OffChainSigned state
    AuthorizationMode public authorizationMode;
    address public signer; // address whose signatures are valid

    // Replay protection mapping: cheque/escrow id + milestone index => consumed
    mapping(bytes32 => bool) public consumedAuthorizations;
    
    // Replay / verification protection
    mapping(uint256 => bool) private _verifyingMilestone;


    event FundsLocked(address indexed buyer, uint256 amount);
    event MilestoneCompleted(uint256 indexed milestoneIndex, uint256 amount);
    event MilestoneVerification(uint256 indexed milestoneIndex, bytes32 indexed obligationId, bool success, bytes32 proofHash);
    event DisputeRaised(uint256 indexed milestoneIndex, address initiator);
    event DisputeResolved(uint256 indexed milestoneIndex, bool releaseFunds);
    event FundsReleased(address indexed seller, uint256 amount);
    event FundsRefunded(address indexed buyer, uint256 amount);

    // OffChainSigned events
    event AuthorizationModeUpdated(AuthorizationMode mode);
    event SignerUpdated(address indexed signer);
    event AuthorizationConsumed(bytes32 indexed authHash, uint256 indexed milestoneIndex);

    modifier onlyBuyer() {
        if (msg.sender != buyer) revert OnlyBuyer();
        _;
    }

    modifier onlyBuyerOrSeller() {
        if (msg.sender != buyer && msg.sender != seller) revert NotBuyerOrSeller();
        _;
    }

    modifier notFinalized() {
        if (isFinalized) revert AlreadyFinalized();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() public {
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
        __EIP712_init("SmartChequeEscrow", "1");
        __AccessControl_init();

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
        authorizationMode = AuthorizationMode.None;
        signer = address(0);

        // Grant roles
        _grantRole(DEFAULT_ADMIN_ROLE, _buyer);
    }

    /**
     * @dev Set authorization mode. Only buyer may change.
     */
    function setAuthorizationMode(AuthorizationMode mode) external onlyBuyer {
        authorizationMode = mode;
        emit AuthorizationModeUpdated(mode);
    }

    /**
     * @dev Set the off-chain signer address. Only buyer may change.
     */
    function setSigner(address _signer) external onlyBuyer {
        signer = _signer;
        emit SignerUpdated(_signer);
    }

    /**
     * @dev Locks funds in the contract
     * @param _token The ERC20 token to be used
     */
    function lockFunds(address _token) external onlyBuyer nonReentrant {
        if (isLocked) revert FundsAlreadyLocked();
        if (_token == address(0)) revert InvalidTotalAmount();

        token = IERC20Upgradeable(_token);
        
        // Transfer tokens from buyer to contract
        token.safeTransferFrom(buyer, address(this), totalAmount);
        
        isLocked = true;
        emit FundsLocked(buyer, totalAmount);
    }

    /**
     * @dev EIP-712 typehash and digest for milestone authorization
     * Typed fields: contract, chainId, escrowId, milestoneIndex, amount, recipient, deadline
     */
    bytes32 private constant MILESTONE_TYPEHASH = keccak256(
        "MilestoneAuthorization(address contractAddress,uint256 chainId,bytes32 escrowId,uint256 milestoneIndex,uint256 amount,address recipient,uint256 deadline)"
    );

    function _hashMilestone(
        bytes32 escrowId,
        uint256 milestoneIndex,
        uint256 amount,
        address recipient,
        uint256 deadline
    ) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    MILESTONE_TYPEHASH,
                    address(this),
                    block.chainid,
                    escrowId,
                    milestoneIndex,
                    amount,
                    recipient,
                    deadline
                )
            )
        );
    }



    function _verifyMilestone(uint256 milestoneIndex, bytes calldata proof ) internal returns (bool) {
        if (_verifyingMilestone[milestoneIndex]) revert VerificationInProgress();
        
        _verifyingMilestone[milestoneIndex] = true;

        bytes32 obligationId = milestones[milestoneIndex].obligationHash;
        bool success = _safeVerifyObligation(obligationId);
        
        emit MilestoneVerification(milestoneIndex, obligationId, success, keccak256(proof));
        
        _verifyingMilestone[milestoneIndex] = false;
        return success;
    }

    function _safeVerifyObligation(bytes32 obligationId) internal returns (bool) {
        if (obligationRegistry == address(0)) return true;
        
        IObligationRegistry reg = IObligationRegistry(obligationRegistry);
        (, , , , bool isVerified, ) = reg.getObligation(obligationId);
        
        if (isVerified) return true;
        
        return reg.verifyObligation(obligationId);
    }

    /**
     * @dev Marks a milestone as completed and releases payment
     * @param milestoneIndex Index of the milestone to complete
     * @param proof Proof of milestone completion
     */
    function _completeMilestone(
        uint256 milestoneIndex,
        bytes calldata proof
    ) internal {
        if (milestoneIndex >= milestones.length) revert InvalidMilestoneIndex();
        Milestone storage milestone = milestones[milestoneIndex];
        if (milestone.isCompleted) revert MilestoneAlreadyCompleted();
        if (milestone.isDisputed) revert MilestoneDisputed();
        if (!_verifyMilestone(milestoneIndex, proof)) revert InvalidSignature();

        milestone.isCompleted = true;

        // Release funds for this milestone
        token.safeTransfer(seller, milestone.amount);

        emit MilestoneCompleted(milestoneIndex, milestone.amount);

        // Finalize if all milestones are completed
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
    ) external onlyBuyerOrSeller nonReentrant notFinalized {
        if (milestoneIndex >= milestones.length) revert InvalidMilestoneIndex();
        if (milestones[milestoneIndex].isCompleted) revert MilestoneAlreadyCompleted();
        if (milestones[milestoneIndex].isDisputed) revert DisputeAlreadyRaised();

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
    ) external nonReentrant notFinalized onlyRole(DISPUTE_MANAGER_ROLE) {
        if (milestoneIndex >= milestones.length) revert InvalidMilestoneIndex();
        if (!milestones[milestoneIndex].isDisputed) revert NoDisputeRaised();

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
     * @dev Executes a partial release resolution for a disputed milestone
     * @param milestoneIndex Index of the milestone
     * @param amountToSeller Amount to transfer to seller; remainder is refunded to buyer
     */
    function resolvePartialRelease(uint256 milestoneIndex, uint256 amountToSeller) external nonReentrant notFinalized onlyRole(DISPUTE_MANAGER_ROLE) {
        if (milestoneIndex >= milestones.length) revert InvalidMilestoneIndex();
        Milestone storage milestone = milestones[milestoneIndex];
        if (!milestone.isDisputed) revert NoDisputeRaised();
        if (milestone.isCompleted) revert MilestoneAlreadyCompleted();
        if (amountToSeller > milestone.amount) revert AmountExceedsMilestone();

        milestone.isDisputed = false;
        milestone.isCompleted = amountToSeller == milestone.amount;

        if (amountToSeller > 0) {
            token.safeTransfer(seller, amountToSeller);
            emit FundsReleased(seller, amountToSeller);
        }
        uint256 refund = milestone.amount - amountToSeller;
        if (refund > 0) {
            token.safeTransfer(buyer, refund);
            emit FundsRefunded(buyer, refund);
        }

        emit DisputeResolved(milestoneIndex, amountToSeller > 0);
    }

    /**
     * @dev Sets the obligation registry address for verification, only buyer can set
     */
    function setObligationRegistry(address registry) external onlyBuyer {
        obligationRegistry = registry;
    }

    /**
     * @dev Grants dispute manager role to an address, only buyer can set per-escrow
     */
    function setDisputeManager(address disputeManager) external onlyBuyer {
        _grantRole(DISPUTE_MANAGER_ROLE, disputeManager);
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
        if (index >= milestones.length) revert InvalidMilestoneIndex();
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
    
    function completeMilestone(
        uint256 milestoneIndex,
        bytes calldata proof
    ) external nonReentrant notFinalized {
        if (!isLocked) revert FundsNotLocked();
        _completeMilestone(milestoneIndex, proof);
    }

    /**
     * @dev Complete milestone via off-chain authorization signature
     * @param escrowId Unique id for cheque/escrow (bytes32)
     * @param milestoneIndex Milestone index
     * @param recipient Payment recipient (usually seller)
     * @param deadline Expiration timestamp for the authorization
     * @param signature EIP-712 signature from signer
     */
    function completeMilestoneWithSignature(
        bytes32 escrowId,
        uint256 milestoneIndex,
        address recipient,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant notFinalized {
        if (!isLocked) revert FundsNotLocked();
        if (authorizationMode != AuthorizationMode.OffChainSigned) revert OffChainSignedDisabled();
        if (signer == address(0)) revert SignerNotSet();
        if (block.timestamp > deadline) revert AuthorizationExpired();
        if (milestoneIndex >= milestones.length) revert InvalidMilestoneIndex();

        Milestone storage milestone = milestones[milestoneIndex];
        if (milestone.isCompleted) revert MilestoneAlreadyCompleted();
        if (milestone.isDisputed) revert MilestoneDisputed();
        if (recipient != seller) revert InvalidRecipient();

        bytes32 digest = _hashMilestone(escrowId, milestoneIndex, milestone.amount, recipient, deadline);
        address recovered = ECDSAUpgradeable.recover(digest, signature);
        if (recovered != signer) revert InvalidSignature();

        // Enhanced authorization replay protection
        bytes32 authHash = keccak256(abi.encodePacked(digest, milestoneIndex, block.chainid));
        if (consumedAuthorizations[authHash]) revert AuthorizationAlreadyUsed();
        
        // Check milestone hasn't been completed
        if (milestone.isCompleted) revert MilestoneAlreadyCompleted();
        
        // Mark authorization as used and milestone as completed
        consumedAuthorizations[authHash] = true;
        milestone.isCompleted = true;
        
        emit AuthorizationConsumed(authHash, milestoneIndex);
        token.safeTransfer(recipient, milestone.amount);
        emit MilestoneCompleted(milestoneIndex, milestone.amount);

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

}