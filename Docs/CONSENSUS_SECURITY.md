# Consensus and Security Implementation

This document provides a comprehensive overview of the Smart Cheques consensus and security implementation, including the architecture, components, and usage guidelines.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Core Components](#core-components)
4. [Deployment Guide](#deployment-guide)
5. [Usage Examples](#usage-examples)
6. [Security Considerations](#security-considerations)
7. [Governance](#governance)
8. [Testing](#testing)
9. [Monitoring](#monitoring)
10. [Troubleshooting](#troubleshooting)

## Overview

The Smart Cheques consensus and security implementation provides a robust Layer 2 solution with:

- **Optimistic Rollup Consensus**: Efficient transaction processing with fraud proof mechanisms
- **Decentralized Governance**: On-chain governance with token-based voting
- **Validator Management**: Comprehensive sequencer registration, staking, and rotation
- **Security Framework**: Slashing mechanisms and fraud detection
- **Upgradeable Architecture**: Future-proof smart contracts with governance-controlled upgrades

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Governance    │    │   Consensus     │    │    Security     │
│                 │    │                 │    │                 │
│ GovernanceToken │◄──►│StateRootManager │◄──►│ SlashingManager │
│ GovernanceDAO   │    │ SequencerManager│    │FraudProofManager│
│ TimelockController│   │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Layer Responsibilities

1. **Governance Layer**: Manages protocol parameters, upgrades, and community decisions
2. **Consensus Layer**: Handles state transitions, block production, and finality
3. **Security Layer**: Enforces validator behavior and detects fraud

## Core Components

### 1. Governance Token (SCGT)

**Purpose**: ERC20 token with voting capabilities for protocol governance

**Key Features**:
- Voting power delegation
- Minting controls with yearly limits
- Pausable functionality
- Upgradeable proxy pattern

**Configuration**:
```solidity
Initial Supply: 1,000,000 SCGT
Max Supply: 100,000,000 SCGT
Max Mint Per Year: 10,000,000 SCGT
```

### 2. Governance DAO

**Purpose**: On-chain governance for protocol decisions

**Key Features**:
- Proposal creation and voting
- Timelock-controlled execution
- Quorum requirements
- Emergency governance capabilities

**Configuration**:
```solidity
Voting Delay: 1 day
Voting Period: 7 days
Proposal Threshold: 1,000 SCGT
Quorum Fraction: 10% (of total supply)
Timelock Delay: 2 days
```

### 3. State Root Manager

**Purpose**: Manages L2 state root submissions and challenges

**Key Features**:
- State root submission by sequencers
- Challenge mechanism with bonds
- Automatic finalization after challenge period
- Integration with fraud proof system

**Configuration**:
```solidity
Challenge Period: 7 days
Challenge Bond: 1,000 SCGT
Finalization Delay: 24 hours
```

### 4. Sequencer Manager

**Purpose**: Manages sequencer registration, staking, and rotation

**Key Features**:
- Sequencer registration with staking
- Automatic rotation based on time or performance
- Delegation support
- Integration with slashing mechanisms

**Configuration**:
```solidity
Minimum Stake: 10,000 SCGT
Block Timeout: 5 minutes
Rotation Period: 24 hours
Downtime Slashing: 1%
Double Sign Slashing: 5%
```

### 5. Slashing Manager

**Purpose**: Handles validator misbehavior and penalties

**Key Features**:
- Evidence-based slashing
- Multiple slashing types and severities
- Jailing and unjailing mechanisms
- Appeal process

**Slashing Types**:
- Double Signing: 5% penalty, 7-day jail
- Downtime: 1% penalty, 1-day jail
- Invalid State: 10% penalty, 30-day jail
- Censorship: 3% penalty, 7-day jail

### 6. Fraud Proof Manager

**Purpose**: Manages fraud detection and verification

**Key Features**:
- Challenge submission with bonds
- Interactive verification games
- Automatic slashing integration
- Reward distribution

**Configuration**:
```solidity
Fraud Proof Bond: 500 SCGT
Verification Period: 3 days
Challenge Types: State Transition, Invalid Block, Censorship
```

## Deployment Guide

### Prerequisites

1. **Development Environment**:
   ```bash
   npm install
   npx hardhat compile
   ```

2. **Network Configuration**:
   ```javascript
   // hardhat.config.js
   networks: {
     mainnet: {
       url: process.env.MAINNET_RPC_URL,
       accounts: [process.env.PRIVATE_KEY]
     }
   }
   ```

### Deployment Steps

1. **Deploy Contracts**:
   ```bash
   npx hardhat run scripts/deploy-consensus-security.js --network <network>
   ```

2. **Verify Contracts**:
   ```bash
   npx hardhat verify --network <network> <contract_address> <constructor_args>
   ```

3. **Initialize System**:
   ```bash
   npx hardhat run scripts/initialize-system.js --network <network>
   ```

### Post-Deployment Configuration

1. **Set up initial sequencers**
2. **Configure governance parameters**
3. **Initialize token distribution**
4. **Set up monitoring and alerts**

## Usage Examples

### Sequencer Registration

```javascript
// 1. Approve tokens for staking
await governanceToken.approve(sequencerManager.address, stakeAmount);

// 2. Register as sequencer
await sequencerManager.registerSequencer(
  stakeAmount,
  "https://sequencer.example.com",
  "My Sequencer"
);
```

### State Root Submission

```javascript
// Submit state root (sequencer only)
await stateRootManager.submitStateRoot(
  blockNumber,
  stateRoot,
  previousStateRoot
);
```

### Challenge Submission

```javascript
// 1. Approve challenge bond
await governanceToken.approve(stateRootManager.address, challengeBond);

// 2. Submit challenge
await stateRootManager.challengeStateRoot(
  blockNumber,
  "Reason for challenge"
);
```

### Fraud Proof Submission

```javascript
// 1. Approve fraud proof bond
await governanceToken.approve(fraudProofManager.address, fraudProofBond);

// 2. Submit fraud proof
await fraudProofManager.submitChallenge(
  accusedSequencer,
  challengeType,
  blockNumber,
  stateRoot,
  transactionHash,
  proofData,
  description
);
```

### Governance Proposal

```javascript
// Create proposal to update parameters
const targets = [stateRootManager.address];
const values = [0];
const calldatas = [
  stateRootManager.interface.encodeFunctionData(
    "updateChallengePeriod",
    [newChallengePeriod]
  )
];
const description = "Update challenge period";

await governanceDAO.propose(targets, values, calldatas, description);
```

## Security Considerations

### 1. Economic Security

- **Staking Requirements**: Minimum stake ensures economic commitment
- **Slashing Penalties**: Proportional to misbehavior severity
- **Challenge Bonds**: Prevent spam attacks on state roots

### 2. Operational Security

- **Key Management**: Use hardware wallets for validator keys
- **Infrastructure**: Secure and redundant sequencer infrastructure
- **Monitoring**: Real-time monitoring of validator performance

### 3. Smart Contract Security

- **Upgradeable Proxies**: Governance-controlled upgrades
- **Access Controls**: Role-based permissions
- **Emergency Mechanisms**: Pause functionality for critical issues

### 4. Governance Security

- **Timelock Delays**: Prevent immediate execution of proposals
- **Quorum Requirements**: Ensure sufficient participation
- **Emergency Governance**: Fast-track critical security updates

## Governance

### Proposal Types

1. **Parameter Updates**: Modify system parameters
2. **Contract Upgrades**: Deploy new contract implementations
3. **Emergency Actions**: Pause/unpause system components
4. **Treasury Management**: Manage protocol treasury

### Voting Process

1. **Proposal Creation**: Token holders create proposals
2. **Voting Delay**: 1-day delay before voting starts
3. **Voting Period**: 7-day voting period
4. **Execution**: 2-day timelock before execution

### Governance Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| Proposal Threshold | 1,000 SCGT | Minimum tokens to create proposal |
| Quorum Fraction | 10% | Minimum participation for valid vote |
| Voting Delay | 1 day | Delay before voting starts |
| Voting Period | 7 days | Duration of voting period |
| Timelock Delay | 2 days | Delay before execution |

## Testing

### Running Tests

```bash
# Run all tests
npx hardhat test

# Run specific test suite
npx hardhat test test/consensus-security.test.js

# Run with coverage
npx hardhat coverage
```

### Test Categories

1. **Unit Tests**: Individual contract functionality
2. **Integration Tests**: Cross-contract interactions
3. **Governance Tests**: Proposal and voting workflows
4. **Security Tests**: Attack scenarios and edge cases

### Test Networks

```bash
# Local development
npx hardhat node
npx hardhat test --network localhost

# Testnet deployment
npx hardhat test --network goerli
```

## Monitoring

### Key Metrics

1. **Consensus Metrics**:
   - Block production rate
   - State root finalization time
   - Challenge frequency

2. **Security Metrics**:
   - Slashing events
   - Fraud proof submissions
   - Validator uptime

3. **Governance Metrics**:
   - Proposal frequency
   - Voting participation
   - Token distribution

### Monitoring Tools

1. **Event Monitoring**: Track contract events
2. **Performance Monitoring**: Monitor sequencer performance
3. **Security Monitoring**: Detect anomalous behavior
4. **Governance Monitoring**: Track proposal lifecycle

### Alerts

- Sequencer downtime
- Challenge submissions
- Slashing events
- Governance proposals
- System pauses

## Troubleshooting

### Common Issues

1. **Sequencer Registration Fails**:
   - Check minimum stake requirement
   - Verify token approval
   - Ensure sequencer not already registered

2. **State Root Challenge Fails**:
   - Verify challenge bond approval
   - Check challenge period hasn't expired
   - Ensure state root exists

3. **Governance Proposal Fails**:
   - Check proposal threshold
   - Verify target contract addresses
   - Ensure proper calldata encoding

### Debug Commands

```bash
# Check contract state
npx hardhat console --network <network>

# Verify contract deployment
npx hardhat verify --network <network> <address>

# Run specific test
npx hardhat test test/specific-test.js --grep "test name"
```

### Support Resources

1. **Documentation**: Comprehensive guides and API reference
2. **Community**: Discord/Telegram for community support
3. **GitHub Issues**: Bug reports and feature requests
4. **Security**: Responsible disclosure process

## Conclusion

The Smart Cheques consensus and security implementation provides a robust foundation for a Layer 2 scaling solution. The modular architecture allows for future enhancements while maintaining security and decentralization.

For additional support or questions, please refer to the community resources or create an issue in the GitHub repository.