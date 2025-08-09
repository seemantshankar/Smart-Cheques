import { expect } from "chai";
import { ethers } from "hardhat";
import { ConsensusManager, ValidatorManager, GovernanceToken } from "../typechain";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers.js";

describe("ConsensusManager Role Management", function () {
  let consensusManager: ConsensusManager;
  let validatorManager: ValidatorManager;
  let governanceToken: GovernanceToken;
  let owner: SignerWithAddress;
  let admin: SignerWithAddress;
  let oracle1: SignerWithAddress;
  let oracle2: SignerWithAddress;
  let validator1: SignerWithAddress;
  let validator2: SignerWithAddress;
  let sequencer1: SignerWithAddress;
  let sequencer2: SignerWithAddress;

  beforeEach(async function () {
    [owner, admin, oracle1, oracle2, validator1, validator2, sequencer1, sequencer2] = await ethers.getSigners();

    // Deploy GovernanceToken
    const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
    governanceToken = await GovernanceToken.deploy("Governance Token", "GOV", "1000000");
    await governanceToken.waitForDeployment();

    // Deploy ValidatorManager
    const ValidatorManager = await ethers.getContractFactory("ValidatorManager");
    validatorManager = await ValidatorManager.deploy(await governanceToken.getAddress());
    await validatorManager.waitForDeployment();

    // Deploy ConsensusManager
    const ConsensusManager = await ethers.getContractFactory("ConsensusManager");
    consensusManager = await ConsensusManager.deploy(await validatorManager.getAddress());
    await consensusManager.waitForDeployment();

    // Grant admin role to admin address
    await consensusManager.grantRole(await consensusManager.ADMIN_ROLE(), admin.address);
  });

  describe("Oracle Role Management", function () {
    it("Should allow admin to grant oracle role", async function () {
      await expect(consensusManager.connect(admin).grantOracleRole(oracle1.address))
      .to.emit(consensusManager, "RoleGranted")
      .withArgs(await consensusManager.ORACLE_ROLE(), oracle1.address, admin.address);

    expect(await consensusManager.hasRole(await consensusManager.ORACLE_ROLE(), oracle1.address)).to.be.true;
    });

    it("Should allow admin to revoke oracle role", async function () {
      await consensusManager.connect(admin).grantOracleRole(oracle1.address);

    await expect(consensusManager.connect(admin).revokeOracleRole(oracle1.address))
      .to.emit(consensusManager, "RoleRevoked")
      .withArgs(await consensusManager.ORACLE_ROLE(), oracle1.address, admin.address);

    expect(await consensusManager.hasRole(await consensusManager.ORACLE_ROLE(), oracle1.address)).to.be.false;
    });

    it("Should not allow non-admin to grant oracle role", async function () {
      await expect(
        consensusManager.connect(oracle1).grantOracleRole(oracle2.address)
      ).to.be.revertedWithCustomError(consensusManager, "AccessControlUnauthorizedAccount");
    });

    it("Should revert when granting oracle role to zero address", async function () {
      await expect(
        consensusManager.connect(admin).grantOracleRole(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid oracle address");
    });
  });

  describe("Validator Role Management", function () {
    it("Should allow admin to grant validator role", async function () {
      await expect(consensusManager.connect(admin).grantValidatorRole(validator1.address))
      .to.emit(consensusManager, "RoleGranted")
      .withArgs(await consensusManager.VALIDATOR_ROLE(), validator1.address, admin.address);

    expect(await consensusManager.hasRole(await consensusManager.VALIDATOR_ROLE(), validator1.address)).to.be.true;
    });

    it("Should allow admin to revoke validator role", async function () {
      await consensusManager.connect(admin).grantValidatorRole(validator1.address);

    await expect(consensusManager.connect(admin).revokeValidatorRole(validator1.address))
      .to.emit(consensusManager, "RoleRevoked")
      .withArgs(await consensusManager.VALIDATOR_ROLE(), validator1.address, admin.address);

    expect(await consensusManager.hasRole(await consensusManager.VALIDATOR_ROLE(), validator1.address)).to.be.false;
    });

    it("Should not allow non-admin to grant validator role", async function () {
      await expect(
        consensusManager.connect(validator1).grantValidatorRole(validator2.address)
      ).to.be.revertedWithCustomError(consensusManager, "AccessControlUnauthorizedAccount");
    });

    it("Should revert when granting validator role to zero address", async function () {
      await expect(
        consensusManager.connect(admin).grantValidatorRole(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid validator address");
    });
  });

  describe("Sequencer Role Management", function () {
    it("Should allow admin to grant sequencer role", async function () {
      await expect(consensusManager.connect(admin).grantSequencerRole(sequencer1.address))
      .to.emit(consensusManager, "RoleGranted")
      .withArgs(await consensusManager.SEQUENCER_ROLE(), sequencer1.address, admin.address);

    expect(await consensusManager.hasRole(await consensusManager.SEQUENCER_ROLE(), sequencer1.address)).to.be.true;
    });

    it("Should allow admin to revoke sequencer role", async function () {
      await consensusManager.connect(admin).grantSequencerRole(sequencer1.address);

    await expect(consensusManager.connect(admin).revokeSequencerRole(sequencer1.address))
      .to.emit(consensusManager, "RoleRevoked")
      .withArgs(await consensusManager.SEQUENCER_ROLE(), sequencer1.address, admin.address);

    expect(await consensusManager.hasRole(await consensusManager.SEQUENCER_ROLE(), sequencer1.address)).to.be.false;
    });

    it("Should not allow non-admin to grant sequencer role", async function () {
      await expect(
        consensusManager.connect(sequencer1).grantSequencerRole(sequencer2.address)
      ).to.be.revertedWithCustomError(consensusManager, "AccessControlUnauthorizedAccount");
    });

    it("Should revert when granting sequencer role to zero address", async function () {
      await expect(
        consensusManager.connect(admin).grantSequencerRole(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid sequencer address");
    });
  });

  describe("Batch Role Setup", function () {
    it("Should allow owner to batch setup roles", async function () {
      const oracles = [oracle1.address, oracle2.address];
      const validators = [validator1.address, validator2.address];
      const sequencers = [sequencer1.address, sequencer2.address];

      await expect(consensusManager.connect(owner).batchSetupRoles(oracles, validators, sequencers))
        .to.emit(consensusManager, "RoleGranted")
        .withArgs(await consensusManager.ORACLE_ROLE(), oracle1.address, owner.address)
      .to.emit(consensusManager, "RoleGranted")
      .withArgs(await consensusManager.VALIDATOR_ROLE(), validator1.address, owner.address)
      .to.emit(consensusManager, "RoleGranted")
      .withArgs(await consensusManager.SEQUENCER_ROLE(), sequencer1.address, owner.address);

    expect(await consensusManager.hasRole(await consensusManager.ORACLE_ROLE(), oracle1.address)).to.be.true;
    expect(await consensusManager.hasRole(await consensusManager.VALIDATOR_ROLE(), validator1.address)).to.be.true;
    expect(await consensusManager.hasRole(await consensusManager.SEQUENCER_ROLE(), sequencer1.address)).to.be.true;
    });

    it("Should revert when batch setup exceeds oracle limit", async function () {
      const oracles = Array(21).fill(ethers.Wallet.createRandom().address);
    const validators = [validator1.address];
    const sequencers = [sequencer1.address];

      await expect(
        consensusManager.connect(owner).batchSetupRoles(oracles, validators, sequencers)
      ).to.be.revertedWith("Too many oracles");
    });

    it("Should revert when batch setup exceeds validator limit", async function () {
      const oracles = [oracle1.address];
    const validators = Array(51).fill(ethers.Wallet.createRandom().address);
    const sequencers = [sequencer1.address];

      await expect(
        consensusManager.connect(owner).batchSetupRoles(oracles, validators, sequencers)
      ).to.be.revertedWith("Too many validators");
    });

    it("Should revert when batch setup exceeds sequencer limit", async function () {
      const oracles = [oracle1.address];
    const validators = [validator1.address];
    const sequencers = Array(11).fill(ethers.Wallet.createRandom().address);

      await expect(
        consensusManager.connect(owner).batchSetupRoles(oracles, validators, sequencers)
      ).to.be.revertedWith("Too many sequencers");
    });

    it("Should skip zero addresses in batch setup", async function () {
      const oracles = [oracle1.address, ethers.ZeroAddress, oracle2.address];
    const validators = [validator1.address, ethers.ZeroAddress, validator2.address];
    const sequencers = [sequencer1.address, ethers.ZeroAddress, sequencer2.address];

      await consensusManager.connect(owner).batchSetupRoles(oracles, validators, sequencers);

      expect(await consensusManager.hasRole(await consensusManager.ORACLE_ROLE(), oracle1.address)).to.be.true;
    expect(await consensusManager.hasRole(await consensusManager.ORACLE_ROLE(), oracle2.address)).to.be.true;
    expect(await consensusManager.hasRole(await consensusManager.VALIDATOR_ROLE(), validator1.address)).to.be.true;
    expect(await consensusManager.hasRole(await consensusManager.VALIDATOR_ROLE(), validator2.address)).to.be.true;
    expect(await consensusManager.hasRole(await consensusManager.SEQUENCER_ROLE(), sequencer1.address)).to.be.true;
    expect(await consensusManager.hasRole(await consensusManager.SEQUENCER_ROLE(), sequencer2.address)).to.be.true;
    });
  });
});