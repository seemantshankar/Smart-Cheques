# OpenZeppelin Implementation Guide for Smart Cheques

## Overview

This guide provides specific implementation recommendations based on OpenZeppelin best practices and the security review findings.

## 1. Critical Security Fixes

### 1.1 Fix SmartChequeEscrow Authorization

**Current Issue**: Missing authorization in `resolveDispute()` function

**OpenZeppelin Solution**:
```solidity
// Add to SmartChequeEscrow.sol
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

contract SmartChequeEscrow is 
    Initializable, 
    ReentrancyGuardUpgradeable,
    AccessControlUpgradeable,  // Add this
    PausableUpgradeable        // Add this
{
    bytes32 public constant DISPUTE_RESOLVER_ROLE = keccak256("DISPUTE_RESOLVER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    
    function initialize(
        address _buyer,
        address _seller,
        uint256 _totalAmount,
        uint256[] memory _milestoneAmounts,
        bytes32[] memory _obligations,
        address _disputeManager  // Add dispute manager address
    ) public initializer {
        __ReentrancyGuard_init();
        __AccessControl_init();
        __Pausable_init();
        
        // Grant roles
        _grantRole(DISPUTE_RESOLVER_ROLE, _disputeManager);
        _grantRole(PAUSER_ROLE, _disputeManager);
        
        // ... rest of initialization
    }
    
    function resolveDispute(
        uint256 milestoneIndex,
        bool releaseFunds
    ) external 
        onlyRole(DISPUTE_RESOLVER_ROLE) 
        nonReentrant 
        notFinalized 
        whenNotPaused 
    {
        // Implementation with proper authorization
    }
    
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }
    
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}
```

### 1.2 Implement Proper Milestone Verification

**Current Issue**: `_verifyMilestone()` always returns true

**OpenZeppelin Solution using Signatures**:
```solidity
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract SmartChequeEscrow {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;
    
    mapping(address => bool) public authorizedOracles;
    
    function _verifyMilestone(
        uint256 milestoneIndex,
        bytes calldata proof
    ) internal view returns (bool) {
        // Decode proof data
        (bytes32 milestoneHash, bytes memory signature) = abi.decode(proof, (bytes32, bytes));
        
        // Create message hash
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                address(this),
                milestoneIndex,
                milestones[milestoneIndex].obligationHash,
                block.chainid
            )
        );
        
        // Verify signature
        address signer = messageHash.toEthSignedMessageHash().recover(signature);
        return authorizedOracles[signer];
    }
    
    function addOracle(address oracle) external onlyRole(ADMIN_ROLE) {
        authorizedOracles[oracle] = true;
    }
    
    function removeOracle(address oracle) external onlyRole(ADMIN_ROLE) {
        authorizedOracles[oracle] = false;
    }
}
```

## 2. Upgrade GovernanceToken to OpenZeppelin v5 Standards

### 2.1 New GovernanceToken Implementation

**Replace existing GovernanceToken.sol with OpenZeppelin v5 pattern**:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC20BurnableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20BurnableUpgradeable.sol";
import {ERC20PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import {ERC20PermitUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import {ERC20VotesUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20VotesUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {NoncesUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/NoncesUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract GovernanceToken is 
    Initializable, 
    ERC20Upgradeable, 
    ERC20BurnableUpgradeable, 
    ERC20PausableUpgradeable, 
    AccessControlUpgradeable, 
    ERC20PermitUpgradeable, 
    ERC20VotesUpgradeable, 
    UUPSUpgradeable 
{
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    
    /// @dev Maximum supply that can ever exist
    uint256 public constant MAX_SUPPLY = 2_000_000_000 ether;
    
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }
    
    function initialize(
        address defaultAdmin,
        address pauser,
        address minter,
        address upgrader,
        uint256 initialSupply
    ) public initializer {
        __ERC20_init("Smart Cheque Governance", "SCG");
        __ERC20Burnable_init();
        __ERC20Pausable_init();
        __AccessControl_init();
        __ERC20Permit_init("Smart Cheque Governance");
        __ERC20Votes_init();
        __UUPSUpgradeable_init();
        
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(PAUSER_ROLE, pauser);
        _grantRole(MINTER_ROLE, minter);
        _grantRole(UPGRADER_ROLE, upgrader);
        
        if (initialSupply > 0) {
            _mint(defaultAdmin, initialSupply);
        }
    }
    
    function pause() public onlyRole(PAUSER_ROLE) {
        _pause();
    }
    
    function unpause() public onlyRole(PAUSER_ROLE) {
        _unpause();
    }
    
    function mint(address to, uint256 amount) public onlyRole(MINTER_ROLE) {
        require(totalSupply() + amount <= MAX_SUPPLY, "Exceeds max supply");
        _mint(to, amount);
    }
    
    function clock() public view override returns (uint48) {
        return uint48(block.timestamp);
    }
    
    function CLOCK_MODE() public pure override returns (string memory) {
        return "mode=timestamp";
    }
    
    function _authorizeUpgrade(address newImplementation)
        internal
        override
        onlyRole(UPGRADER_ROLE)
    {}
    
    // Required overrides
    function _update(address from, address to, uint256 value)
        internal
        override(ERC20Upgradeable, ERC20PausableUpgradeable, ERC20VotesUpgradeable)
    {
        super._update(from, to, value);
    }
    
    function nonces(address owner)
        public
        view
        override(ERC20PermitUpgradeable, NoncesUpgradeable)
        returns (uint256)
    {
        return super.nonces(owner);
    }
}
```

## 3. Implement Governor Contract

### 3.1 Create GovernanceDAO using OpenZeppelin Governor

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {GovernorUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/GovernorUpgradeable.sol";
import {GovernorCountingSimpleUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorCountingSimpleUpgradeable.sol";
import {GovernorSettingsUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorSettingsUpgradeable.sol";
import {GovernorStorageUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorStorageUpgradeable.sol";
import {GovernorTimelockControlUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorTimelockControlUpgradeable.sol";
import {GovernorVotesUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorVotesUpgradeable.sol";
import {GovernorVotesQuorumFractionUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorVotesQuorumFractionUpgradeable.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {TimelockControllerUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/TimelockControllerUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract SmartChequeGovernor is 
    Initializable, 
    GovernorUpgradeable, 
    GovernorSettingsUpgradeable, 
    GovernorCountingSimpleUpgradeable, 
    GovernorStorageUpgradeable, 
    GovernorVotesUpgradeable, 
    GovernorVotesQuorumFractionUpgradeable, 
    GovernorTimelockControlUpgradeable, 
    UUPSUpgradeable 
{
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }
    
    function initialize(
        IVotes _token, 
        TimelockControllerUpgradeable _timelock
    ) public initializer {
        __Governor_init("SmartChequeGovernor");
        __GovernorSettings_init(
            1 days,    // voting delay
            1 weeks,   // voting period
            1000e18    // proposal threshold
        );
        __GovernorCountingSimple_init();
        __GovernorStorage_init();
        __GovernorVotes_init(_token);
        __GovernorVotesQuorumFraction_init(4); // 4% quorum
        __GovernorTimelockControl_init(_timelock);
        __UUPSUpgradeable_init();
    }
    
    function _authorizeUpgrade(address newImplementation)
        internal
        override
        onlyGovernance
    {}
    
    // Required overrides...
    // [Include all the override functions from the OpenZeppelin output]
}
```

## 4. Enhanced Security Patterns

### 4.1 Circuit Breaker Pattern for Bridge

```solidity
contract ERC20Bridge {
    uint256 public constant DAILY_WITHDRAWAL_LIMIT = 1000000 ether;
    uint256 public dailyWithdrawn;
    uint256 public lastResetTime;
    
    modifier withinDailyLimit(uint256 amount) {
        if (block.timestamp >= lastResetTime + 1 days) {
            dailyWithdrawn = 0;
            lastResetTime = block.timestamp;
        }
        
        require(
            dailyWithdrawn + amount <= DAILY_WITHDRAWAL_LIMIT,
            "Daily withdrawal limit exceeded"
        );
        
        dailyWithdrawn += amount;
        _;
    }
    
    function withdraw(
        address token,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) external withinDailyLimit(amount) {
        // Withdrawal logic
    }
}
```

### 4.2 Emergency Pause with Time Delay

```solidity
import "@openzeppelin/contracts/governance/TimelockController.sol";

contract EmergencyPause {
    TimelockController public timelock;
    uint256 public constant EMERGENCY_DELAY = 2 hours;
    
    mapping(bytes32 => uint256) public emergencyActions;
    
    function emergencyPause(address target) external onlyRole(EMERGENCY_ROLE) {
        bytes32 actionId = keccak256(abi.encodePacked("PAUSE", target));
        emergencyActions[actionId] = block.timestamp + EMERGENCY_DELAY;
    }
    
    function executePause(address target) external {
        bytes32 actionId = keccak256(abi.encodePacked("PAUSE", target));
        require(
            emergencyActions[actionId] != 0 && 
            block.timestamp >= emergencyActions[actionId],
            "Emergency delay not met"
        );
        
        IPausable(target).pause();
        delete emergencyActions[actionId];
    }
}
```

## 5. Testing Framework

### 5.1 Comprehensive Test Suite Structure

```javascript
// test/SmartChequeEscrow.test.js
const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("SmartChequeEscrow", function () {
    async function deployFixture() {
        const [owner, buyer, seller, disputeManager] = await ethers.getSigners();
        
        // Deploy mock token
        const MockToken = await ethers.getContractFactory("MockERC20");
        const token = await MockToken.deploy("Test Token", "TEST");
        
        // Deploy escrow
        const SmartChequeEscrow = await ethers.getContractFactory("SmartChequeEscrow");
        const escrow = await upgrades.deployProxy(SmartChequeEscrow, [
            buyer.address,
            seller.address,
            ethers.parseEther("100"),
            [ethers.parseEther("50"), ethers.parseEther("50")],
            [ethers.keccak256(ethers.toUtf8Bytes("milestone1")), 
             ethers.keccak256(ethers.toUtf8Bytes("milestone2"))],
            disputeManager.address
        ]);
        
        return { escrow, token, owner, buyer, seller, disputeManager };
    }
    
    describe("Security Tests", function () {
        it("Should prevent unauthorized dispute resolution", async function () {
            const { escrow, buyer } = await loadFixture(deployFixture);
            
            await expect(
                escrow.connect(buyer).resolveDispute(0, true)
            ).to.be.revertedWith("AccessControl: account");
        });
        
        it("Should prevent reentrancy attacks", async function () {
            // Implement reentrancy test
        });
        
        it("Should handle pause/unpause correctly", async function () {
            // Implement pause test
        });
    });
});
```

## 6. Deployment Scripts

### 6.1 Secure Deployment Script

```javascript
// scripts/deploy-secure.js
const { ethers, upgrades } = require("hardhat");
const { verify } = require("../utils/verify");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying with account:", deployer.address);
    
    // Deploy Timelock
    const TimelockController = await ethers.getContractFactory("TimelockControllerUpgradeable");
    const timelock = await upgrades.deployProxy(TimelockController, [
        2 * 24 * 60 * 60, // 2 days delay
        [deployer.address], // proposers
        [deployer.address], // executors
        deployer.address    // admin
    ]);
    await timelock.waitForDeployment();
    console.log("Timelock deployed to:", await timelock.getAddress());
    
    // Deploy GovernanceToken
    const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
    const token = await upgrades.deployProxy(GovernanceToken, [
        deployer.address,  // admin
        deployer.address,  // pauser
        deployer.address,  // minter
        deployer.address,  // upgrader
        ethers.parseEther("1000000") // initial supply
    ]);
    await token.waitForDeployment();
    console.log("GovernanceToken deployed to:", await token.getAddress());
    
    // Deploy Governor
    const Governor = await ethers.getContractFactory("SmartChequeGovernor");
    const governor = await upgrades.deployProxy(Governor, [
        await token.getAddress(),
        await timelock.getAddress()
    ]);
    await governor.waitForDeployment();
    console.log("Governor deployed to:", await governor.getAddress());
    
    // Verify contracts
    if (network.name !== "hardhat" && network.name !== "localhost") {
        await verify(await timelock.getAddress(), []);
        await verify(await token.getAddress(), []);
        await verify(await governor.getAddress(), []);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
```

## 7. Monitoring and Alerting

### 7.1 OpenZeppelin Defender Integration

```javascript
// defender/autotasks/monitor.js
const { DefenderRelaySigner, DefenderRelayProvider } = require('defender-relay-client/lib/ethers');
const { ethers } = require('ethers');

exports.handler = async function(event) {
    const provider = new DefenderRelayProvider(event);
    const signer = new DefenderRelaySigner(event, provider, { speed: 'fast' });
    
    // Monitor for large withdrawals
    const bridge = new ethers.Contract(BRIDGE_ADDRESS, BRIDGE_ABI, provider);
    
    const filter = bridge.filters.TokenWithdrawn();
    const events = await bridge.queryFilter(filter, -100); // Last 100 blocks
    
    for (const event of events) {
        if (event.args.amount > ethers.parseEther("10000")) {
            // Alert for large withdrawal
            await sendAlert({
                type: 'LARGE_WITHDRAWAL',
                amount: event.args.amount,
                recipient: event.args.recipient,
                txHash: event.transactionHash
            });
        }
    }
};
```

## 8. Upgrade Procedures

### 8.1 Safe Upgrade Process

```javascript
// scripts/upgrade.js
const { ethers, upgrades } = require("hardhat");

async function upgradeContract(proxyAddress, newImplementationName) {
    console.log(`Upgrading ${newImplementationName}...`);
    
    const NewImplementation = await ethers.getContractFactory(newImplementationName);
    
    // Validate upgrade
    await upgrades.validateUpgrade(proxyAddress, NewImplementation);
    
    // Perform upgrade
    const upgraded = await upgrades.upgradeProxy(proxyAddress, NewImplementation);
    
    console.log(`${newImplementationName} upgraded at:`, await upgraded.getAddress());
    
    return upgraded;
}

// Usage
async function main() {
    await upgradeContract(ESCROW_PROXY_ADDRESS, "SmartChequeEscrowV2");
    await upgradeContract(TOKEN_PROXY_ADDRESS, "GovernanceTokenV2");
}
```

## Implementation Priority

### Phase 1 (Critical - Immediate)
1. Fix authorization in SmartChequeEscrow
2. Implement proper milestone verification
3. Add pause functionality to all contracts

### Phase 2 (High Priority - 1-2 weeks)
1. Upgrade GovernanceToken to OpenZeppelin v5
2. Implement Governor contract
3. Add comprehensive testing

### Phase 3 (Medium Priority - 1 month)
1. Implement circuit breakers
2. Add monitoring and alerting
3. Conduct security audit

### Phase 4 (Long-term - 2-3 months)
1. Implement formal verification
2. Add advanced security features
3. Optimize gas usage

This implementation guide provides a roadmap for securing the Smart Cheques project using OpenZeppelin best practices. Each section includes specific code examples and implementation steps.