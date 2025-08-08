import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("ValidatorManagerRoles", function () {
  let validatorManager: any;
  let governanceToken: any;
  let admin: SignerWithAddress;

  beforeEach(async function () {
        [owner, admin, oracle1, oracle2, sequencer1, sequencer2, validator1, validator2] = await ethers.getSigners();

        // Deploy GovernanceToken
        const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
        governanceToken = await GovernanceToken.deploy("Governance Token", "GOV", "1000000");
        await governanceToken.waitForDeployment();

        // Deploy ValidatorManager
        const ValidatorManager = await ethers.getContractFactory("ValidatorManager");
        validatorManager = await ValidatorManager.deploy(await governanceToken.getAddress());
        await validatorManager.waitForDeployment();
        
        // Grant admin role
        await validatorManager.grantRole(await validatorManager.ADMIN_ROLE(), admin.target);
    });
});