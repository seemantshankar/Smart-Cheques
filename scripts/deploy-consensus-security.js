const { ethers, upgrades } = require("hardhat");
const { parseEther } = ethers.utils;

/**
 * Deployment script for Consensus and Security Implementation
 * Deploys all contracts in the correct order with proper initialization
 */
async function main() {
    console.log("Starting Consensus and Security Implementation deployment...");
    
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with account:", deployer.address);
    console.log("Account balance:", (await deployer.getBalance()).toString());

    // Deployment configuration
    const config = {
        // Consensus parameters
        challengePeriod: 7 * 24 * 60 * 60, // 7 days
        challengeBond: parseEther("1000"), // 1000 tokens
        finalizationDelay: 24 * 60 * 60, // 24 hours
        
        // Sequencer parameters
        minStake: parseEther("10000"), // 10k tokens
        blockTimeout: 300, // 5 minutes
        rotationPeriod: 24 * 60 * 60, // 24 hours
        downtimeSlashingPercentage: 100, // 1%
        doubleSignSlashingPercentage: 500, // 5%
        
        // Governance parameters
        votingDelay: 1 * 24 * 60 * 60, // 1 day
        votingPeriod: 7 * 24 * 60 * 60, // 7 days
        proposalThreshold: parseEther("1000"), // 1000 tokens
        quorumFraction: 10, // 10%
        timelockDelay: 2 * 24 * 60 * 60, // 2 days
        
        // Token parameters
        initialSupply: parseEther("1000000"), // 1M tokens
        maxSupply: parseEther("100000000"), // 100M tokens
        maxMintPerYear: parseEther("10000000"), // 10M tokens per year
        
        // Security parameters
        fraudProofBond: parseEther("500"), // 500 tokens
        verificationPeriod: 3 * 24 * 60 * 60, // 3 days
        maxChallengesPerBlock: 10
    };

    const deployedContracts = {};

    try {
        // 1. Deploy Governance Token
        console.log("\n1. Deploying Governance Token...");
        const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
        const governanceToken = await upgrades.deployProxy(
            GovernanceToken,
            [
                "Smart Cheques Governance Token",
                "SCGT",
                config.initialSupply,
                config.maxSupply,
                config.maxMintPerYear,
                deployer.address
            ],
            { initializer: "initialize" }
        );
        await governanceToken.deployed();
        deployedContracts.governanceToken = governanceToken.address;
        console.log("Governance Token deployed to:", governanceToken.address);

        // 2. Deploy Timelock Controller
        console.log("\n2. Deploying Timelock Controller...");
        const TimelockController = await ethers.getContractFactory("TimelockController");
        const timelock = await TimelockController.deploy(
            config.timelockDelay,
            [deployer.address], // proposers
            [deployer.address], // executors
            deployer.address // admin
        );
        await timelock.deployed();
        deployedContracts.timelock = timelock.address;
        console.log("Timelock Controller deployed to:", timelock.address);

        // 3. Deploy Governance DAO
        console.log("\n3. Deploying Governance DAO...");
        const GovernanceDAO = await ethers.getContractFactory("GovernanceDAO");
        const governanceDAO = await upgrades.deployProxy(
            GovernanceDAO,
            [
                governanceToken.address,
                timelock.address,
                config.votingDelay,
                config.votingPeriod,
                config.proposalThreshold,
                config.quorumFraction
            ],
            { initializer: "initialize" }
        );
        await governanceDAO.deployed();
        deployedContracts.governanceDAO = governanceDAO.address;
        console.log("Governance DAO deployed to:", governanceDAO.address);

        // 4. Deploy State Root Manager
        console.log("\n4. Deploying State Root Manager...");
        const StateRootManager = await ethers.getContractFactory("StateRootManager");
        const stateRootManager = await upgrades.deployProxy(
            StateRootManager,
            [
                governanceToken.address,
                config.challengePeriod,
                config.challengeBond,
                config.finalizationDelay
            ],
            { initializer: "initialize" }
        );
        await stateRootManager.deployed();
        deployedContracts.stateRootManager = stateRootManager.address;
        console.log("State Root Manager deployed to:", stateRootManager.address);

        // 5. Deploy Sequencer Manager
        console.log("\n5. Deploying Sequencer Manager...");
        const SequencerManager = await ethers.getContractFactory("SequencerManager");
        const sequencerManager = await upgrades.deployProxy(
            SequencerManager,
            [
                governanceToken.address,
                config.minStake,
                config.blockTimeout,
                config.rotationPeriod,
                config.downtimeSlashingPercentage,
                config.doubleSignSlashingPercentage
            ],
            { initializer: "initialize" }
        );
        await sequencerManager.deployed();
        deployedContracts.sequencerManager = sequencerManager.address;
        console.log("Sequencer Manager deployed to:", sequencerManager.address);

        // 6. Deploy Slashing Manager
        console.log("\n6. Deploying Slashing Manager...");
        const SlashingManager = await ethers.getContractFactory("SlashingManager");
        const slashingManager = await upgrades.deployProxy(
            SlashingManager,
            [
                governanceToken.address,
                sequencerManager.address,
                deployer.address // treasury for now
            ],
            { initializer: "initialize" }
        );
        await slashingManager.deployed();
        deployedContracts.slashingManager = slashingManager.address;
        console.log("Slashing Manager deployed to:", slashingManager.address);

        // 7. Deploy Fraud Proof Manager
        console.log("\n7. Deploying Fraud Proof Manager...");
        const FraudProofManager = await ethers.getContractFactory("FraudProofManager");
        const fraudProofManager = await upgrades.deployProxy(
            FraudProofManager,
            [
                governanceToken.address,
                stateRootManager.address,
                slashingManager.address,
                config.fraudProofBond,
                config.challengePeriod,
                config.verificationPeriod
            ],
            { initializer: "initialize" }
        );
        await fraudProofManager.deployed();
        deployedContracts.fraudProofManager = fraudProofManager.address;
        console.log("Fraud Proof Manager deployed to:", fraudProofManager.address);

        // 8. Configure contract relationships
        console.log("\n8. Configuring contract relationships...");
        
        // Grant roles to contracts
        const SEQUENCER_ROLE = await stateRootManager.SEQUENCER_ROLE();
        const CHALLENGER_ROLE = await stateRootManager.CHALLENGER_ROLE();
        const SLASHER_ROLE = await slashingManager.SLASHER_ROLE();
        const EVIDENCE_SUBMITTER_ROLE = await slashingManager.EVIDENCE_SUBMITTER_ROLE();
        const CHALLENGER_ROLE_FRAUD = await fraudProofManager.CHALLENGER_ROLE();
        const VERIFIER_ROLE = await fraudProofManager.VERIFIER_ROLE();
        
        // State Root Manager roles
        await stateRootManager.grantRole(SEQUENCER_ROLE, sequencerManager.address);
        await stateRootManager.grantRole(CHALLENGER_ROLE, fraudProofManager.address);
        
        // Slashing Manager roles
        await slashingManager.grantRole(SLASHER_ROLE, sequencerManager.address);
        await slashingManager.grantRole(SLASHER_ROLE, fraudProofManager.address);
        await slashingManager.grantRole(EVIDENCE_SUBMITTER_ROLE, fraudProofManager.address);
        
        // Fraud Proof Manager roles
        await fraudProofManager.grantRole(CHALLENGER_ROLE_FRAUD, deployer.address);
        await fraudProofManager.grantRole(VERIFIER_ROLE, deployer.address);
        
        // Timelock roles for governance
        const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
        const EXECUTOR_ROLE = await timelock.EXECUTOR_ROLE();
        await timelock.grantRole(PROPOSER_ROLE, governanceDAO.address);
        await timelock.grantRole(EXECUTOR_ROLE, governanceDAO.address);
        
        console.log("Contract relationships configured successfully!");

        // 9. Initial token distribution
        console.log("\n9. Setting up initial token distribution...");
        
        // Mint initial tokens for testing
        const MINTER_ROLE = await governanceToken.MINTER_ROLE();
        await governanceToken.grantRole(MINTER_ROLE, deployer.address);
        
        // Mint tokens for deployer (for testing)
        await governanceToken.mint(deployer.address, parseEther("100000"));
        
        // Delegate voting power to self
        await governanceToken.delegate(deployer.address);
        
        console.log("Initial token distribution completed!");

        // 10. Verify deployments
        console.log("\n10. Verifying deployments...");
        
        // Check governance token
        const tokenName = await governanceToken.name();
        const tokenSymbol = await governanceToken.symbol();
        const totalSupply = await governanceToken.totalSupply();
        console.log(`Governance Token: ${tokenName} (${tokenSymbol}), Total Supply: ${ethers.utils.formatEther(totalSupply)}`);
        
        // Check state root manager
        const challengePeriod = await stateRootManager.challengePeriod();
        console.log(`State Root Manager: Challenge Period: ${challengePeriod} seconds`);
        
        // Check sequencer manager
        const minStake = await sequencerManager.minStake();
        console.log(`Sequencer Manager: Min Stake: ${ethers.utils.formatEther(minStake)}`);
        
        console.log("\nDeployment verification completed!");

        // 11. Save deployment addresses
        console.log("\n11. Saving deployment addresses...");
        
        const fs = require('fs');
        const deploymentData = {
            network: network.name,
            timestamp: new Date().toISOString(),
            deployer: deployer.address,
            contracts: deployedContracts,
            config: config
        };
        
        const deploymentFile = `deployments/consensus-security-${network.name}-${Date.now()}.json`;
        fs.writeFileSync(deploymentFile, JSON.stringify(deploymentData, null, 2));
        console.log(`Deployment data saved to: ${deploymentFile}`);

        // 12. Generate summary
        console.log("\n" + "=".repeat(80));
        console.log("CONSENSUS AND SECURITY IMPLEMENTATION DEPLOYMENT SUMMARY");
        console.log("=".repeat(80));
        console.log(`Network: ${network.name}`);
        console.log(`Deployer: ${deployer.address}`);
        console.log(`Timestamp: ${new Date().toISOString()}`);
        console.log("\nDeployed Contracts:");
        console.log("-".repeat(50));
        Object.entries(deployedContracts).forEach(([name, address]) => {
            console.log(`${name.padEnd(25)}: ${address}`);
        });
        
        console.log("\nNext Steps:");
        console.log("-".repeat(50));
        console.log("1. Register initial sequencers using SequencerManager");
        console.log("2. Submit initial state roots using StateRootManager");
        console.log("3. Test governance proposals using GovernanceDAO");
        console.log("4. Configure monitoring and alerting for slashing events");
        console.log("5. Set up fraud proof verification infrastructure");
        console.log("6. Update network configuration with new contract addresses");
        
        console.log("\nDeployment completed successfully! 🎉");
        console.log("=".repeat(80));

    } catch (error) {
        console.error("\nDeployment failed:", error);
        
        // Save partial deployment data for debugging
        if (Object.keys(deployedContracts).length > 0) {
            const fs = require('fs');
            const partialData = {
                network: network.name,
                timestamp: new Date().toISOString(),
                deployer: deployer.address,
                contracts: deployedContracts,
                error: error.message,
                status: "PARTIAL_DEPLOYMENT"
            };
            
            const errorFile = `deployments/failed-consensus-security-${network.name}-${Date.now()}.json`;
            fs.writeFileSync(errorFile, JSON.stringify(partialData, null, 2));
            console.log(`Partial deployment data saved to: ${errorFile}`);
        }
        
        throw error;
    }
}

// Execute deployment
if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
}

module.exports = main;