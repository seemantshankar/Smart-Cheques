// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title ERC20Bridge
 * @dev Bridge contract for ERC-20 tokens between L1 and L2
 * @notice Handles deposits on L1 and withdrawals with Merkle proofs
 */
contract ERC20Bridge is 
    UUPSUpgradeable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable
{
    using SafeERC20 for IERC20;

    // Custom Errors (consolidated, duplicates and unused removed)
    error InvalidRecipient();
    error AlreadyProcessed();
    error InvalidProof();
    error InsufficientValidatorQuorum();
    error InvalidValidator();
    error UnauthorizedAccess();
    error InvalidAmount();
    error InvalidToken();
    error ChallengeStillActive();
    error AmountBelowMinimum();

    // Roles
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // Constants
    uint256 public constant CHALLENGE_PERIOD = 7 days;
    uint256 public constant MIN_DEPOSIT_AMOUNT = 1e15; // 0.001 tokens (18 decimals)
    uint256 public constant MAX_DEPOSIT_AMOUNT = 1e24; // 1M tokens (18 decimals)
    uint256 public constant VALIDATOR_QUORUM = 67; // 67% (2/3 + 1)

    // Structs
    struct DepositData {
        address token;
        address depositor;
        address recipient;
        uint256 amount;
        uint256 blockNumber;
        uint256 timestamp;
        bytes32 txHash;
        bool processed;
    }

    struct WithdrawalData {
        address token;
        address recipient;
        uint256 amount;
        uint256 l2BlockNumber;
        bytes32 l2TxHash;
        bytes32 merkleRoot;
        bool processed;
        uint256 challengeDeadline;
    }

    struct ValidatorSignature {
        address validator;
        bytes signature;
        uint256 timestamp;
    }

    // State variables
    mapping(bytes32 => DepositData) public deposits;
    mapping(bytes32 => WithdrawalData) public withdrawals;
    mapping(bytes32 => bool) public processedExits;
    mapping(address => address) public tokenMappings; // L1 token -> L2 token
    mapping(address => bool) public supportedTokens;
    mapping(address => uint256) public validatorStakes;
    mapping(bytes32 => mapping(address => bool)) public validatorVotes;

    
    address[] public validators;
    uint256 public totalValidatorStake;
    uint256 public minValidatorStake;
    bytes32 public currentMerkleRoot;
    uint256 public lastRootUpdate;
    uint256 public depositNonce;
    uint256 public withdrawalNonce;

    // Events
    event TokenDeposited(
        bytes32 indexed depositId,
        address indexed token,
        address indexed depositor,
        address recipient,
        uint256 amount,
        uint256 blockNumber
    );

    event TokenWithdrawn(
        bytes32 indexed withdrawalId,
        address indexed token,
        address indexed recipient,
        uint256 amount,
        bytes32 l2TxHash
    );

    event TokenMapped(
        address indexed l1Token,
        address indexed l2Token
    );

    event ValidatorAdded(
        address indexed validator,
        uint256 stake
    );

    event ValidatorRemoved(
        address indexed validator
    );

    event MerkleRootUpdated(
        bytes32 indexed oldRoot,
        bytes32 indexed newRoot,
        uint256 timestamp
    );

    event WithdrawalChallenged(
        bytes32 indexed withdrawalId,
        address indexed challenger
    );



    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() public {
        _disableInitializers();
    }

    /**
     * @dev Initialize the bridge contract
     * @param admin Admin address
     * @param _minValidatorStake Minimum stake required for validators
     */
    function initialize(
        address admin,
        uint256 _minValidatorStake
    ) public initializer {
        __UUPSUpgradeable_init();
        __AccessControl_init();
        __ReentrancyGuard_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);
        
        minValidatorStake = _minValidatorStake;
        depositNonce = 1;
        withdrawalNonce = 1;
    }

    /**
     * @dev Deposit tokens to L2
     * @param token L1 token address
     * @param amount Amount to deposit
     * @param recipient Recipient address on L2
     */
    function depositToken(
        address token,
        uint256 amount,
        address recipient
    ) external nonReentrant whenNotPaused {
        if (!supportedTokens[token]) revert InvalidToken();
        if (amount < MIN_DEPOSIT_AMOUNT || amount > MAX_DEPOSIT_AMOUNT) {
            revert InvalidAmount();
        }
        if (recipient == address(0)) recipient = msg.sender;

        bytes32 depositId = keccak256(
            abi.encodePacked(
                block.chainid,
                address(this),
                depositNonce++,
                block.timestamp
            )
        );

        // Update state before external call (CEI pattern)
        deposits[depositId] = DepositData({
            token: token,
            depositor: msg.sender,
            recipient: recipient,
            amount: amount,
            blockNumber: block.number,
            timestamp: block.timestamp,
            txHash: blockhash(block.number - 1),
            processed: false
        });

        // External interaction after state changes
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        emit TokenDeposited(
            depositId,
            token,
            msg.sender,
            recipient,
            amount,
            block.number
        );
    }

    /**
     * @notice Withdraw tokens from L2 with Merkle proof
     * @param withdrawalId Unique withdrawal identifier
     * @param token L1 token address
     * @param recipient Recipient address
     * @param amount Amount to withdraw
     * @param l2BlockNumber L2 block number
     * @param l2TxHash L2 transaction hash
     * @param merkleProof Merkle proof for the withdrawal
     * @param validatorSignatures Validator signatures
     */
    function withdrawToken(
        bytes32 withdrawalId,
        address token,
        address recipient,
        uint256 amount,
        uint256 l2BlockNumber,
        bytes32 l2TxHash,
        bytes32[] calldata merkleProof,
        ValidatorSignature[] calldata validatorSignatures
    ) external nonReentrant whenNotPaused {
        if (processedExits[withdrawalId]) revert AlreadyProcessed();
        if (!supportedTokens[token]) revert InvalidToken();
    
        _verifyValidatorQuorum(withdrawalId, validatorSignatures);
        _verifyMerkleProof(withdrawalId, token, recipient, amount, l2BlockNumber, l2TxHash, merkleProof);
        _storeWithdrawalData(withdrawalId, token, recipient, amount, l2BlockNumber, l2TxHash);
    
        emit TokenWithdrawn(
            withdrawalId,
            token,
            recipient,
            amount,
            l2TxHash
        );
    }
    
    /**
     * @dev Internal function to verify Merkle proof
     * @param withdrawalId Withdrawal identifier
     */
    function _verifyMerkleProof(
        bytes32 withdrawalId,
        address token,
        address recipient,
        uint256 amount,
        uint256 l2BlockNumber,
        bytes32 l2TxHash,
        bytes32[] calldata merkleProof
    ) internal view {
        bytes32 leaf = keccak256(
            abi.encodePacked(
                withdrawalId,
                token,
                recipient,
                amount,
                l2BlockNumber,
                l2TxHash
            )
        );
        
        if (!MerkleProof.verify(merkleProof, currentMerkleRoot, leaf)) {
            revert InvalidProof();
        }
    }
    
    /**
     * @dev Internal function to store withdrawal data
     * @param withdrawalId Withdrawal identifier
     */
    function _storeWithdrawalData(
        bytes32 withdrawalId,
        address token,
        address recipient,
        uint256 amount,
        uint256 l2BlockNumber,
        bytes32 l2TxHash
    ) internal {
        withdrawals[withdrawalId] = WithdrawalData({
            token: token,
            recipient: recipient,
            amount: amount,
            l2BlockNumber: l2BlockNumber,
            l2TxHash: l2TxHash,
            merkleRoot: currentMerkleRoot,
            processed: false,
            challengeDeadline: block.timestamp + CHALLENGE_PERIOD
        });
    }

    /**
     * @dev Challenge a withdrawal during challenge period
     * @param withdrawalId Withdrawal identifier
     */
    function challengeWithdrawal(
        bytes32 withdrawalId
    ) external {
        WithdrawalData storage withdrawal = withdrawals[withdrawalId];
        
        if (withdrawal.processed) revert AlreadyProcessed();
        if (block.timestamp >= withdrawal.challengeDeadline) {
            revert ChallengeStillActive();
        }
        if (!hasRole(VALIDATOR_ROLE, msg.sender)) revert InvalidValidator();

        // Extend challenge deadline
        withdrawal.challengeDeadline += CHALLENGE_PERIOD;

        emit WithdrawalChallenged(withdrawalId, msg.sender);
    }

    /**
     * @dev Finalize withdrawal after challenge period
     * @param withdrawalId Withdrawal identifier
     */
    function finalizeWithdrawal(
        bytes32 withdrawalId
    ) external nonReentrant {
        WithdrawalData storage withdrawal = withdrawals[withdrawalId];
        
        if (withdrawal.processed) revert AlreadyProcessed();
        if (block.timestamp < withdrawal.challengeDeadline) {
            revert ChallengeStillActive();
        }

        withdrawal.processed = true;
        processedExits[withdrawalId] = true;

        // Transfer tokens to recipient
        IERC20(withdrawal.token).safeTransfer(
            withdrawal.recipient,
            withdrawal.amount
        );
    }

    /**
     * @dev Add supported token mapping
     * @param l1Token L1 token address
     * @param l2Token L2 token address
     */
    function addTokenMapping(
        address l1Token,
        address l2Token
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        tokenMappings[l1Token] = l2Token;
        supportedTokens[l1Token] = true;
        
        emit TokenMapped(l1Token, l2Token);
    }





    /**
     * @dev Update Merkle root with validator consensus
     * @param newRoot New Merkle root
     * @param validatorSignatures Validator signatures
     */
    function updateMerkleRoot(
        bytes32 newRoot,
        ValidatorSignature[] calldata validatorSignatures
    ) external onlyRole(RELAYER_ROLE) {
        bytes32 updateId = keccak256(abi.encodePacked("UPDATE_ROOT", newRoot));
        
        _verifyValidatorQuorum(updateId, validatorSignatures);
        
        bytes32 oldRoot = currentMerkleRoot;
        currentMerkleRoot = newRoot;
        lastRootUpdate = block.timestamp;
        
        emit MerkleRootUpdated(oldRoot, newRoot, block.timestamp);
    }

    /**
     * @dev Verify validator quorum for operations
     * @param operationId Operation identifier
     * @param signatures Validator signatures
     */
    function _verifyValidatorQuorum(
        bytes32 operationId,
        ValidatorSignature[] calldata signatures
    ) internal {
        uint256 validStake = 0;

        for (uint256 i = 0; i < signatures.length; i++) {
            address validator = signatures[i].validator;
            if (!hasRole(VALIDATOR_ROLE, validator)) continue;
            if (validatorVotes[operationId][validator]) continue;

            bytes32 messageHash = ECDSA.toEthSignedMessageHash(operationId);
            address recovered = ECDSA.recover(messageHash, signatures[i].signature);
            if (recovered != validator) continue;

            validatorVotes[operationId][validator] = true;
            validStake += validatorStakes[validator];
        }

        uint256 requiredStake = (totalValidatorStake * VALIDATOR_QUORUM) / 100;
        if (validStake < requiredStake) revert InsufficientValidatorQuorum();
    }

    /**
     * @dev Pause the contract
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /**
     * @dev Unpause the contract
     */
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /**
     * @dev Update the minimum validator stake
     * @param newMinValidatorStake New minimum stake amount
     */
    function updateMinValidatorStake(uint256 newMinValidatorStake) external onlyRole(UPGRADER_ROLE) {
        minValidatorStake = newMinValidatorStake;
    }

    /**
     * @dev Add a validator to the validator set
     * @param validator Validator address to add
     * @param stake Amount of tokens staked by validator
     */
    function addValidator(address validator, uint256 stake) external onlyRole(ADMIN_ROLE) {
        if (validator == address(0)) revert InvalidRecipient();
        if (stake < minValidatorStake) revert AmountBelowMinimum();
        if (validatorStakes[validator] != 0) revert UnauthorizedAccess();
        
        validatorStakes[validator] = stake;
        totalValidatorStake += stake;
        validators.push(validator);
        
        _grantRole(VALIDATOR_ROLE, validator);
        
        emit ValidatorAdded(validator, stake);
    }

    /**
     * @dev Remove a validator from the validator set
     * @param validator Validator address to remove
     */
    function removeValidator(address validator) external onlyRole(ADMIN_ROLE) {
        if (validatorStakes[validator] == 0) revert UnauthorizedAccess();
        
        uint256 stake = validatorStakes[validator];
        validatorStakes[validator] = 0;
        totalValidatorStake -= stake;
        
        // Remove from validators array
        for (uint256 i = 0; i < validators.length; i++) {
            if (validators[i] == validator) {
                validators[i] = validators[validators.length - 1];
                validators.pop();
                break;
            }
        }
        
        _revokeRole(VALIDATOR_ROLE, validator);
        
        emit ValidatorRemoved(validator);
    }

    /**
     * @dev Grant relayer role to an address
     * @param relayer Address to grant relayer role
     */
    function grantRelayerRole(address relayer) external onlyRole(ADMIN_ROLE) {
        if (relayer == address(0)) revert InvalidRecipient();
        _grantRole(RELAYER_ROLE, relayer);
    }

    /**
     * @dev Revoke relayer role from an address
     * @param relayer Address to revoke relayer role
     */
    function revokeRelayerRole(address relayer) external onlyRole(ADMIN_ROLE) {
        _revokeRole(RELAYER_ROLE, relayer);
    }

    /**
     * @dev Batch grant roles for initial setup
     * @param relayers Array of relayer addresses
     * @param validatorsData Array of validator addresses
     * @param stakes Array of stakes for validators
     */
    function batchSetupRoles(
        address[] calldata relayers,
        address[] calldata validatorsData,
        uint256[] calldata stakes
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (relayers.length > 10) revert InvalidAmount();
        if (validatorsData.length != stakes.length) revert InvalidAmount();
        if (validatorsData.length > 100) revert InvalidAmount();
        
        // Grant relayer roles
        for (uint256 i = 0; i < relayers.length; i++) {
            if (relayers[i] != address(0)) {
                _grantRole(RELAYER_ROLE, relayers[i]);
            }
        }
        
        // Add validators
        for (uint256 i = 0; i < validatorsData.length; i++) {
            if (validatorsData[i] != address(0) && stakes[i] >= minValidatorStake) {
                validatorStakes[validatorsData[i]] = stakes[i];
                totalValidatorStake += stakes[i];
                validators.push(validatorsData[i]);
                _grantRole(VALIDATOR_ROLE, validatorsData[i]);
                emit ValidatorAdded(validatorsData[i], stakes[i]);
            }
        }
    }

    /**
     * @dev Authorize upgrade
     */
    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(UPGRADER_ROLE) {
        if (newImplementation == address(0)) revert InvalidRecipient();
    }

    /**
     * @dev Get validator count
     */
    function getValidatorCount() external view returns (uint256) {
        return validators.length;
    }

    /**
     * @dev Get deposit data
     */
    function getDeposit(
        bytes32 depositId
    ) external view returns (DepositData memory) {
        return deposits[depositId];
    }

    /**
     * @dev Get withdrawal data
     */
    function getWithdrawal(
        bytes32 withdrawalId
    ) external view returns (WithdrawalData memory) {
        return withdrawals[withdrawalId];
    }
}