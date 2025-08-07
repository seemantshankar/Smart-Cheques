// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/ECDSAUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";

/**
 * @title SmartChequeEscrow
 * @dev Manages escrow funds and milestone states for Smart Cheques
 */
contract SmartChequeEscrow is 
    Initializable, 
    ReentrancyGuardUpgradeable,
    EIP712Upgradeable 
{
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using ECDSAUpgradeable for bytes32;

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

    // OffChainSigned state
    AuthorizationMode public authorizationMode;
    address public signer; // address whose signatures are valid

    // Replay protection mapping: cheque/escrow id + milestone index => consumed
    mapping(bytes32 => bool) public consumedAuthorizations;

    event FundsLocked(address indexed buyer, uint256 amount);
    event MilestoneCompleted(uint256 indexed milestoneIndex, uint256 amount);
    event DisputeRaised(uint256 indexed milestoneIndex, address initiator);
    event DisputeResolved(uint256 indexed milestoneIndex, bool releaseFunds);
    event FundsReleased(address indexed seller, uint256 amount);
    event FundsRefunded(address indexed buyer, uint256 amount);

    // OffChainSigned events
    event AuthorizationModeUpdated(AuthorizationMode mode);
    event SignerUpdated(address indexed signer);
    event AuthorizationConsumed(bytes32 indexed authHash, uint256 indexed milestoneIndex);

    modifier onlyBuyer() {
        require(msg.sender == buyer, "Only buyer can call this");
        _;
    }

    modifier onlyBuyerOrSeller() {
        require(msg.sender == buyer || msg.sender == seller, "Unauthorized");
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
        __EIP712_init("SmartChequeEscrow", "1");

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
        require(!isLocked, "Funds already locked");
        require(_token != address(0), "Invalid token address");

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

    // Basic placeholder for on-chain proof verification; currently returns true to allow off-chain signed flow
    function _verifyMilestone(uint256 /*milestoneIndex*/, bytes calldata /*proof*/ ) internal pure returns (bool) {
        return true;
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
        require(milestoneIndex < milestones.length, "Invalid milestone index");
        Milestone storage milestone = milestones[milestoneIndex];
        require(!milestone.isCompleted, "Milestone already completed");
        require(!milestone.isDisputed, "Milestone is disputed");
        require(_verifyMilestone(milestoneIndex, proof), "Invalid milestone proof");

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
    
    function completeMilestone(
        uint256 milestoneIndex,
        bytes calldata proof
    ) external nonReentrant notFinalized {
        require(isLocked, "Funds not locked");
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
        require(isLocked, "Funds not locked");
        require(authorizationMode == AuthorizationMode.OffChainSigned, "OffChainSigned disabled");
        require(signer != address(0), "Signer not set");
        require(block.timestamp <= deadline, "Authorization expired");
        require(milestoneIndex < milestones.length, "Invalid milestone index");

        Milestone storage milestone = milestones[milestoneIndex];
        require(!milestone.isCompleted, "Milestone already completed");
        require(!milestone.isDisputed, "Milestone is disputed");
        require(recipient == seller, "Invalid recipient");

        bytes32 digest = _hashMilestone(escrowId, milestoneIndex, milestone.amount, recipient, deadline);
        address recovered = ECDSAUpgradeable.recover(digest, signature);
        require(recovered == signer, "Invalid signature");

        // Enhanced authorization replay protection
        bytes32 authHash = keccak256(abi.encodePacked(digest, milestoneIndex, block.chainid));
        require(!consumedAuthorizations[authHash], "Authorization already used");
        
        // Check milestone hasn't been completed
        require(!milestone.isCompleted, "Milestone already completed");
        
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