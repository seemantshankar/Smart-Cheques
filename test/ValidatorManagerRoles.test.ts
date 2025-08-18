import hre from "hardhat";
const { ethers } = hre;
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers.js";

describe("ValidatorManagerRoles", function () {
  let validatorManager: any;
  let governanceToken: any;
  let owner: SignerWithAddress;
  let admin: SignerWithAddress;
  let oracle1: SignerWithAddress;
  let oracle2: SignerWithAddress;
  let sequencer1: SignerWithAddress;
  let sequencer2: SignerWithAddress;
  let validator1: SignerWithAddress;
  let validator2: SignerWithAddress;

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
        await validatorManager.grantRole(await validatorManager.ADMIN_ROLE(), admin.address);
    });
});