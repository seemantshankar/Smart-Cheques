import { ethers } from "hardhat";
import { Contract } from "ethers";
import * as hre from "hardhat";

async function main() {
  console.log("Starting deployment process...");

  // Deploy GovernanceToken
  console.log("Deploying GovernanceToken...");
  const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
  const governanceToken = await GovernanceToken.deploy();
  await governanceToken.deployed();
  console.log("GovernanceToken deployed to:", governanceToken.address);

  // Deploy TimelockController
  console.log("Deploying SmartChequeTimelockController...");
  const proposers: string[] = [process.env.TIMELOCK_PROPOSER || (await ethers.getSigners())[0].address];
  const executors: string[] = [process.env.TIMELOCK_EXECUTOR || (await ethers.getSigners())[0].address];
  const admin: string = process.env.TIMELOCK_ADMIN || (await ethers.getSigners())[0].address;
  const Timelock = await ethers.getContractFactory("SmartChequeTimelockController");
  const timelock = await Timelock.deploy(2, proposers, executors, admin);
  await timelock.deployed();
  console.log("Timelock deployed to:", timelock.address);

  // Deploy Governor wired to token + timelock
  console.log("Deploying SmartChequeGovernor...");
  const Governor = await ethers.getContractFactory("SmartChequeGovernor");
  const governor = await Governor.deploy(governanceToken.address, timelock.address);
  await governor.deployed();
  console.log("SmartChequeGovernor deployed to:", governor.address);

  // Deploy SmartChequeFactory
  console.log("Deploying SmartChequeFactory...");
  const SmartChequeFactory = await ethers.getContractFactory("SmartChequeFactory");
  const smartChequeFactory = (await hre.upgrades.deployProxy(SmartChequeFactory, [], {
    initializer: "initialize",
    kind: "uups"
  })) as Contract;
  await smartChequeFactory.deployed();
  console.log("SmartChequeFactory deployed to:", smartChequeFactory.address);

  // Deploy ObligationRegistry
  console.log("Deploying ObligationRegistry...");
  const ObligationRegistry = await ethers.getContractFactory("ObligationRegistry");
  const obligationRegistry = (await hre.upgrades.deployProxy(ObligationRegistry, [], {
    initializer: "initialize",
    kind: "uups"
  })) as Contract;
  await obligationRegistry.deployed();
  console.log("ObligationRegistry deployed to:", obligationRegistry.address);

  // Deploy DisputeManager
  console.log("Deploying DisputeManager...");
  const DisputeManager = await ethers.getContractFactory("DisputeManager");
  const disputeManager = (await hre.upgrades.deployProxy(DisputeManager, [], {
    initializer: "initialize",
    kind: "uups"
  })) as Contract;
  await disputeManager.deployed();
  console.log("DisputeManager deployed to:", disputeManager.address);

  // Set up roles and permissions
  console.log("Setting up roles and permissions...");

  // Get the deployer's address
  const [deployer] = await ethers.getSigners();

  // Grant OPERATOR_ROLE in SmartChequeFactory
  const OPERATOR_ROLE = await smartChequeFactory.OPERATOR_ROLE();
  await smartChequeFactory.grantRole(OPERATOR_ROLE, deployer.address);

  // Grant ORACLE_ROLE in ObligationRegistry
  const ORACLE_ROLE = await obligationRegistry.ORACLE_ROLE();
  await obligationRegistry.grantRole(ORACLE_ROLE, deployer.address);

  // Grant ARBITRATOR_ROLE in DisputeManager
  const ARBITRATOR_ROLE = await disputeManager.ARBITRATOR_ROLE();
  await disputeManager.grantRole(ARBITRATOR_ROLE, deployer.address);

  // Configure per-escrow dispute manager and registry after deployments (to be called per escrow post-creation)
  // Example: The frontend/backend should call setDisputeManager and setObligationRegistry on new escrows.

  // Transfer ownership/roles to timelock (timelock as admin)
  console.log("Transferring admin roles to Timelock...");
  // Grant DEFAULT_ADMIN_ROLE to timelock where relevant then revoke from deployer
  await smartChequeFactory.grantRole(await smartChequeFactory.DEFAULT_ADMIN_ROLE(), timelock.address);
  await obligationRegistry.grantRole(await obligationRegistry.DEFAULT_ADMIN_ROLE(), timelock.address);
  await disputeManager.grantRole(await disputeManager.DEFAULT_ADMIN_ROLE(), timelock.address);
  // Grant ADMIN_ROLE to timelock on upgradeables
  if (smartChequeFactory.functions["ADMIN_ROLE"]) {
    await smartChequeFactory.grantRole(await smartChequeFactory.ADMIN_ROLE(), timelock.address);
    await smartChequeFactory.revokeRole(await smartChequeFactory.ADMIN_ROLE(), deployer.address);
  }
  if (obligationRegistry.functions["ADMIN_ROLE"]) {
    await obligationRegistry.grantRole(await obligationRegistry.ADMIN_ROLE(), timelock.address);
    await obligationRegistry.revokeRole(await obligationRegistry.ADMIN_ROLE(), deployer.address);
  }
  if (disputeManager.functions["ADMIN_ROLE"]) {
    await disputeManager.grantRole(await disputeManager.ADMIN_ROLE(), timelock.address);
    await disputeManager.revokeRole(await disputeManager.ADMIN_ROLE(), deployer.address);
  }

  // Configure Timelock proposers/executors
  const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
  const EXECUTOR_ROLE = await timelock.EXECUTOR_ROLE();
  await timelock.grantRole(PROPOSER_ROLE, governor.address);
  // Allow anyone to execute by granting to zero address if desired; otherwise use env EXECUTOR
  const executor = process.env.TIMELOCK_EXECUTOR || ethers.constants.AddressZero;
  await timelock.grantRole(EXECUTOR_ROLE, executor);
  // Revoke deployer admin
  await timelock.revokeRole(await timelock.DEFAULT_ADMIN_ROLE(), deployer.address);

  // Set treasury on ValidatorManager (when deployed later) using env var
  const treasury = process.env.TREASURY_ADDRESS || deployer.address;
  console.log("Treasury address:", treasury);

  console.log("Deployment completed successfully!");
  console.log("\nDeployment Summary:");
  console.log("-------------------");
  console.log(`GovernanceToken: ${governanceToken.address}`);
  console.log(`Timelock: ${timelock.address}`);
  console.log(`Governor: ${governor.address}`);
  console.log(`SmartChequeFactory: ${smartChequeFactory.address}`);
  console.log(`ObligationRegistry: ${obligationRegistry.address}`);
  console.log(`DisputeManager: ${disputeManager.address}`);

  // Verify contracts on Etherscan
  if (process.env.ETHERSCAN_API_KEY) {
    console.log("\nVerifying contracts on Etherscan...");
    try {
      await hre.run("verify:verify", {
        address: smartChequeFactory.address,
        constructorArguments: []
      });
      await hre.run("verify:verify", {
        address: obligationRegistry.address,
        constructorArguments: []
      });
      await hre.run("verify:verify", {
        address: disputeManager.address,
        constructorArguments: []
      });
      console.log("Contract verification completed!");
    } catch (error) {
      console.log("Error verifying contracts:", error);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: Error) => {
    console.error(error);
    process.exit(1);
  });