// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

contract SmartChequeTimelockController is TimelockController {
    uint256 public constant EMERGENCY_DELAY = 1; // 1 block for testing
    uint256 public constant STANDARD_DELAY = 2; // 2 blocks for testing
    uint256 public constant CRITICAL_DELAY = 5; // 5 blocks for testing
    
    enum ProposalCategory {
        STANDARD,
        EMERGENCY,
        CRITICAL
    }
    
    mapping(bytes32 => ProposalCategory) public proposalCategories;
    
    bool public emergencyMode = false;
    
    event EmergencyModeActivated();
    event EmergencyModeDeactivated();
    event ProposalCategorized(bytes32 indexed id, ProposalCategory category);
    
    constructor(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin
    ) TimelockController(minDelay, proposers, executors, admin) {
        // Grant admin role to the deployer for testing
        if (admin != address(0)) {
            _grantRole(DEFAULT_ADMIN_ROLE, admin);
        }
    }
    
    function activateEmergencyMode() external onlyRole(DEFAULT_ADMIN_ROLE) {
        emergencyMode = true;
        emit EmergencyModeActivated();
    }
    
    function deactivateEmergencyMode() external onlyRole(DEFAULT_ADMIN_ROLE) {
        emergencyMode = false;
        emit EmergencyModeDeactivated();
    }
    
    function scheduleWithCategory(
        address target,
        uint256 value,
        bytes calldata data,
        bytes32 predecessor,
        bytes32 salt,
        ProposalCategory category
    ) public returns (bytes32) {
        uint256 delay = _getDelayForCategory(category);
        
        bytes32 id = hashOperation(target, value, data, predecessor, salt);
        proposalCategories[id] = category;
        
        schedule(target, value, data, predecessor, salt, delay);
        emit ProposalCategorized(id, category);
        return id;
    }
    
    function scheduleEmergency(
        address target,
        uint256 value,
        bytes calldata data,
        bytes32 predecessor,
        bytes32 salt
    ) external returns (bytes32) {
        require(hasRole(PROPOSER_ROLE, msg.sender), "TimelockController: sender requires permission");
        
        bytes32 id = hashOperation(target, value, data, predecessor, salt);
        proposalCategories[id] = ProposalCategory.EMERGENCY;
        
        schedule(target, value, data, predecessor, salt, EMERGENCY_DELAY);
        return id;
    }
    
    function _getDelayForCategory(ProposalCategory category) internal pure returns (uint256) {
        if (category == ProposalCategory.EMERGENCY) {
            return EMERGENCY_DELAY;
        } else if (category == ProposalCategory.CRITICAL) {
            return CRITICAL_DELAY;
        } else {
            return STANDARD_DELAY;
        }
    }
}