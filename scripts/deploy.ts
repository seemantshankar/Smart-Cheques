import { ethers } from "hardhat";
import { Contract } from "ethers";
import * as hre from "hardhat";

async function main() {
  console.log("Starting deployment process...");

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

  console.log("Deployment completed successfully!");
  console.log("\nDeployment Summary:");
  console.log("-------------------");
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