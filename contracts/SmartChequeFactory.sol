// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import "./SmartChequeEscrow.sol";

/**
 * @title SmartChequeFactory
 * @dev Factory contract for deploying new Smart Cheque instances
 */
contract SmartChequeFactory is 
    Initializable, 
    AccessControlUpgradeable, 
    PausableUpgradeable, 
    UUPSUpgradeable 
{
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // Mapping from cheque ID to cheque address
    mapping(bytes32 => address) public cheques;
    
    // Array to store all cheque IDs
    bytes32[] public chequeIds;

    // Beacon for SmartChequeEscrow implementation
    UpgradeableBeacon public escrowBeacon;

    event ChequeCreated(
        bytes32 indexed chequeId,
        address indexed chequeAddress,
        address indexed buyer,
        address seller,
        uint256 totalAmount
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

        // Deploy the implementation contract
        SmartChequeEscrow escrowImplementation = new SmartChequeEscrow();
        
        // Create the beacon with the implementation
        escrowBeacon = new UpgradeableBeacon(address(escrowImplementation));
    }

    /**
     * @dev Creates a new Smart Cheque instance
     * @param buyer The address of the buyer
     * @param seller The address of the seller
     * @param totalAmount The total amount to be locked in the cheque
     * @param milestones Array of milestone amounts
     * @param obligations Array of obligation hashes
     * @return chequeId The ID of the created cheque
     */
    function createCheque(
        address buyer,
        address seller,
        uint256 totalAmount,
        uint256[] memory milestones,
        bytes32[] memory obligations
    ) external whenNotPaused returns (bytes32) {
        require(buyer != address(0), "Invalid buyer address");
        require(seller != address(0), "Invalid seller address");
        require(totalAmount > 0, "Invalid total amount");
        require(milestones.length > 0, "No milestones provided");
        require(milestones.length == obligations.length, "Milestones and obligations length mismatch");

        uint256 totalMilestoneAmount = 0;
        for (uint256 i = 0; i < milestones.length; i++) {
            totalMilestoneAmount += milestones[i];
        }
        require(totalMilestoneAmount == totalAmount, "Milestone amounts do not match total");

        // Generate unique cheque ID
        bytes32 chequeId = keccak256(
            abi.encodePacked(
                buyer,
                seller,
                totalAmount,
                block.timestamp
            )
        );
        require(cheques[chequeId] == address(0), "Cheque ID already exists");

        // Create initialization data
        bytes memory initData = abi.encodeWithSelector(
            SmartChequeEscrow.initialize.selector,
            buyer,
            seller,
            totalAmount,
            milestones,
            obligations
        );

        // Deploy new BeaconProxy with initialization data
        BeaconProxy newCheque = new BeaconProxy(
            address(escrowBeacon),
            initData
        );

        cheques[chequeId] = address(newCheque);
        chequeIds.push(chequeId);

        emit ChequeCreated(
            chequeId,
            address(newCheque),
            buyer,
            seller,
            totalAmount
        );

        return chequeId;
    }

    /**
     * @dev Returns the address of a cheque by its ID
     * @param chequeId The ID of the cheque
     * @return The address of the cheque contract
     */
    function getChequeAddress(bytes32 chequeId) external view returns (address) {
        return cheques[chequeId];
    }

    /**
     * @dev Returns the total number of cheques created
     * @return The number of cheques
     */
    function getTotalCheques() external view returns (uint256) {
        return chequeIds.length;
    }

    /**
     * @dev Updates the SmartChequeEscrow implementation
     * @param newImplementation The address of the new implementation
     */
    function updateEscrowImplementation(address newImplementation) external onlyRole(ADMIN_ROLE) {
        escrowBeacon.upgradeTo(newImplementation);
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