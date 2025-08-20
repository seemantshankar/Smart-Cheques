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
  const isDev = hre.network.name === "hardhat" || hre.network.name === "localhost";
  const proposers: string[] = [process.env.TIMELOCK_PROPOSER || (await ethers.getSigners())[0].address];
  const executorsEnv = process.env.TIMELOCK_EXECUTOR;
  const executors: string[] = [executorsEnv || (isDev ? (await ethers.getSigners())[0].address : "")].filter(Boolean) as string[];
  const adminEnv = process.env.TIMELOCK_ADMIN;
  const admin: string = adminEnv || (await ethers.getSigners())[0].address;
  if (!isDev) {
    if (!executorsEnv || executorsEnv === (await ethers.getSigners())[0].address) {
      throw new Error("TIMELOCK_EXECUTOR must be set to a multisig/non-deployer address on non-dev networks");
    }
    if (!adminEnv || adminEnv === (await ethers.getSigners())[0].address) {
      throw new Error("TIMELOCK_ADMIN must be set to a multisig/non-deployer address on non-dev networks");
    }
  }
  const Timelock = await ethers.getContractFactory("SmartChequeTimelockController");
  const defaultDelay = (hre.network.name === "hardhat" || hre.network.name === "localhost") ? 2 : 172800; // 2 days on non-dev
  const delay = Number(process.env.TIMELOCK_DELAY || String(defaultDelay));
  const timelock = await Timelock.deploy(delay, proposers, executors, admin);
  await timelock.deployed();
  console.log("Timelock deployed to:", timelock.address);
  // Ensure timelock can self-administer roles
  try {
    await timelock.grantRole(await timelock.DEFAULT_ADMIN_ROLE(), await timelock.getAddress());
  } catch {}

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
  // Revoke deployer's DEFAULT_ADMIN_ROLE from contracts
  await smartChequeFactory.revokeRole(await smartChequeFactory.DEFAULT_ADMIN_ROLE(), deployer.address);
  await obligationRegistry.revokeRole(await obligationRegistry.DEFAULT_ADMIN_ROLE(), deployer.address);
  await disputeManager.revokeRole(await disputeManager.DEFAULT_ADMIN_ROLE(), deployer.address);
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
  const executor = process.env.TIMELOCK_EXECUTOR || (ethers as any).constants?.AddressZero || "0x0000000000000000000000000000000000000000";
  await timelock.grantRole(EXECUTOR_ROLE, executor);
  // Revoke deployer proposer/executor roles if present
  try { await timelock.revokeRole(PROPOSER_ROLE, deployer.address); } catch {}
  try { await timelock.revokeRole(EXECUTOR_ROLE, deployer.address); } catch {}
  // Revoke deployer admin on timelock
  await timelock.revokeRole(await timelock.DEFAULT_ADMIN_ROLE(), deployer.address);

  // Optionally wire bridges to timelock if addresses provided
  const erc20BridgeAddress = process.env.ERC20_BRIDGE_ADDRESS;
  const nativeBridgeAddress = process.env.NATIVE_BRIDGE_ADDRESS;
  const zeroAddr = (ethers as any).constants?.AddressZero || "0x0000000000000000000000000000000000000000";
  const addressesToWire = [
    { name: "ERC20Bridge", address: erc20BridgeAddress },
    { name: "NativeBridge", address: nativeBridgeAddress }
  ].filter(x => x.address && x.address !== zeroAddr);
  for (const entry of addressesToWire) {
    try {
      console.log(`Wiring ${entry.name} roles to Timelock at ${entry.address}...`);
      const contract = await ethers.getContractAt(entry.name, entry.address);
      const DEFAULT_ADMIN_ROLE = await contract.DEFAULT_ADMIN_ROLE();
      await contract.grantRole(DEFAULT_ADMIN_ROLE, timelock.address);
      try { await contract.revokeRole(DEFAULT_ADMIN_ROLE, deployer.address); } catch {}
      if (contract.functions["UPGRADER_ROLE"]) {
        const UPGRADER_ROLE = await contract.UPGRADER_ROLE();
        await contract.grantRole(UPGRADER_ROLE, timelock.address);
        try { await contract.revokeRole(UPGRADER_ROLE, deployer.address); } catch {}
      }
    } catch (e) {
      console.warn(`Skipping ${entry.name} wiring due to error:`, e);
    }
  }

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