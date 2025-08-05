// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title ObligationRegistry
 * @dev Manages obligation data and oracle integrations for Smart Cheques
 */
contract ObligationRegistry is 
    Initializable, 
    AccessControlUpgradeable, 
    PausableUpgradeable, 
    UUPSUpgradeable 
{
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    struct Obligation {
        bytes32 hash;
        address oracleAddress;
        bytes4 oracleFunction;
        bytes parameters;
        bool isVerified;
        uint256 verificationTimestamp;
    }

    // Mapping from obligation ID to Obligation
    mapping(bytes32 => Obligation) public obligations;
    
    // Mapping from oracle to its reliability score (0-100)
    mapping(address => uint8) public oracleScores;
    
    // Minimum required oracle score
    uint8 public minimumOracleScore;

    event ObligationRegistered(
        bytes32 indexed obligationId,
        bytes32 hash,
        address indexed oracleAddress
    );

    event ObligationVerified(
        bytes32 indexed obligationId,
        bool success,
        uint256 timestamp
    );

    event OracleScoreUpdated(
        address indexed oracle,
        uint8 newScore
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

        minimumOracleScore = 70; // Default minimum score
    }

    /**
     * @dev Registers a new obligation with oracle details
     * @param hash Hash of the obligation details
     * @param oracleAddress Address of the oracle contract
     * @param oracleFunction Function selector for oracle verification
     * @param parameters Encoded parameters for oracle verification
     * @return obligationId The ID of the registered obligation
     */
    function registerObligation(
        bytes32 hash,
        address oracleAddress,
        bytes4 oracleFunction,
        bytes calldata parameters
    ) external whenNotPaused returns (bytes32) {
        require(oracleAddress != address(0), "Invalid oracle address");
        require(oracleScores[oracleAddress] >= minimumOracleScore, "Oracle score too low");

        bytes32 obligationId = keccak256(
            abi.encodePacked(
                hash,
                oracleAddress,
                oracleFunction,
                parameters
            )
        );

        require(obligations[obligationId].hash == bytes32(0), "Obligation already exists");

        obligations[obligationId] = Obligation({
            hash: hash,
            oracleAddress: oracleAddress,
            oracleFunction: oracleFunction,
            parameters: parameters,
            isVerified: false,
            verificationTimestamp: 0
        });

        emit ObligationRegistered(obligationId, hash, oracleAddress);

        return obligationId;
    }

    /**
     * @dev Verifies an obligation using oracle data
     * @param obligationId ID of the obligation to verify
     * @return success Whether the verification was successful
     */
    function verifyObligation(
        bytes32 obligationId
    ) external whenNotPaused returns (bool success) {
        Obligation storage obligation = obligations[obligationId];
        require(obligation.hash != bytes32(0), "Obligation does not exist");
        require(!obligation.isVerified, "Obligation already verified");

        // Call oracle contract to verify obligation
        (success, ) = obligation.oracleAddress.call(
            abi.encodePacked(obligation.oracleFunction, obligation.parameters)
        );

        if (success) {
            obligation.isVerified = true;
            obligation.verificationTimestamp = block.timestamp;
        }

        emit ObligationVerified(obligationId, success, block.timestamp);

        return success;
    }

    /**
     * @dev Updates the reliability score of an oracle
     * @param oracle Address of the oracle
     * @param newScore New reliability score (0-100)
     */
    function updateOracleScore(
        address oracle,
        uint8 newScore
    ) external onlyRole(ADMIN_ROLE) {
        require(oracle != address(0), "Invalid oracle address");
        require(newScore <= 100, "Score must be between 0 and 100");

        oracleScores[oracle] = newScore;
        emit OracleScoreUpdated(oracle, newScore);
    }

    /**
     * @dev Updates the minimum required oracle score
     * @param newMinimumScore New minimum score (0-100)
     */
    function updateMinimumOracleScore(
        uint8 newMinimumScore
    ) external onlyRole(ADMIN_ROLE) {
        require(newMinimumScore <= 100, "Score must be between 0 and 100");
        minimumOracleScore = newMinimumScore;
    }

    /**
     * @dev Returns obligation details
     * @param obligationId ID of the obligation
     */
    function getObligation(bytes32 obligationId) external view returns (
        bytes32 hash,
        address oracleAddress,
        bytes4 oracleFunction,
        bytes memory parameters,
        bool isVerified,
        uint256 verificationTimestamp
    ) {
        Obligation storage obligation = obligations[obligationId];
        return (
            obligation.hash,
            obligation.oracleAddress,
            obligation.oracleFunction,
            obligation.parameters,
            obligation.isVerified,
            obligation.verificationTimestamp
        );
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