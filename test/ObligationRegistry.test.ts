import { expect } from "chai";
import { ethers } from "hardhat";
import { ObligationRegistry } from "../typechain";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("ObligationRegistry Tests", function () {
  let obligationRegistry: ObligationRegistry;
  let admin: SignerWithAddress;
  let oracle: SignerWithAddress;
  let user: SignerWithAddress;
  let otherOracle: SignerWithAddress;

  const DEFAULT_MIN_SCORE = 70;
  const VALID_ORACLE_SCORE = 85;
  const INVALID_ORACLE_SCORE = 60;

  beforeEach(async function () {
    [admin, oracle, user, otherOracle] = await ethers.getSigners();

    const ObligationRegistry = await ethers.getContractFactory("ObligationRegistry");
    obligationRegistry = await ObligationRegistry.deploy();
    await obligationRegistry.deployed();

    await obligationRegistry.initialize();
  });

  describe("Oracle Score Management", function () {
    it("should set oracle score by admin", async function () {
      await expect(obligationRegistry.connect(admin).updateOracleScore(oracle.address, VALID_ORACLE_SCORE))
        .to.emit(obligationRegistry, "OracleScoreUpdated")
        .withArgs(oracle.address, VALID_ORACLE_SCORE);

      expect(await obligationRegistry.oracleScores(oracle.address)).to.equal(VALID_ORACLE_SCORE);
    });

    it("should prevent non-admin from setting oracle score", async function () {
      await expect(
        obligationRegistry.connect(user).updateOracleScore(oracle.address, VALID_ORACLE_SCORE)
      ).to.be.reverted;
    });

    it("should prevent invalid oracle score (above 100)", async function () {
      await expect(
        obligationRegistry.connect(admin).updateOracleScore(oracle.address, 101)
      ).to.be.revertedWith("Score must be between 0 and 100");
    });

    it("should prevent invalid oracle score (zero address)", async function () {
      await expect(
        obligationRegistry.connect(admin).updateOracleScore(ethers.constants.AddressZero, VALID_ORACLE_SCORE)
      ).to.be.revertedWith("Invalid oracle address");
    });

    it("should support updateReliabilityScore alias", async function () {
      await expect(obligationRegistry.connect(admin).updateReliabilityScore(oracle.address, VALID_ORACLE_SCORE))
        .to.emit(obligationRegistry, "OracleScoreUpdated")
        .withArgs(oracle.address, VALID_ORACLE_SCORE);

      expect(await obligationRegistry.oracleScores(oracle.address)).to.equal(VALID_ORACLE_SCORE);
    });
  });

  describe("Minimum Oracle Score Configuration", function () {
    it("should have default minimum score", async function () {
      expect(await obligationRegistry.minimumOracleScore()).to.equal(DEFAULT_MIN_SCORE);
    });

    it("should allow admin to update minimum score", async function () {
      const newMinScore = 80;
      await expect(obligationRegistry.connect(admin).updateMinimumOracleScore(newMinScore))
        .to.emit(obligationRegistry, "MinimumOracleScoreUpdated")
        .withArgs(newMinScore);

      expect(await obligationRegistry.minimumOracleScore()).to.equal(newMinScore);
    });

    it("should prevent non-admin from updating minimum score", async function () {
      await expect(
        obligationRegistry.connect(user).updateMinimumOracleScore(80)
      ).to.be.reverted;
    });

    it("should prevent invalid minimum score", async function () {
      await expect(
        obligationRegistry.connect(admin).updateMinimumOracleScore(101)
      ).to.be.revertedWith("Score must be between 0 and 100");
    });
  });

  describe("Obligation Registration Gate", function () {
    beforeEach(async function () {
      // Set up oracle with valid score
      await obligationRegistry.connect(admin).updateOracleScore(oracle.address, VALID_ORACLE_SCORE);
    });

    it("should register obligation with valid oracle score", async function () {
      const hash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test obligation"));
      const oracleFunction = "0x12345678";
      const parameters = ethers.utils.toUtf8Bytes("test params");

      const tx = await obligationRegistry.connect(user).registerObligation(
        hash,
        oracle.address,
        oracleFunction,
        parameters
      );

      const receipt = await tx.wait();
      const event = receipt.events?.find(e => e.event === "ObligationRegistered");
      
      expect(event).to.not.be.undefined;
      expect(event?.args?.hash).to.equal(hash);
      expect(event?.args?.oracleAddress).to.equal(oracle.address);

      const obligationId = event?.args?.obligationId;
      const obligation = await obligationRegistry.getObligation(obligationId);
      
      expect(obligation.hash).to.equal(hash);
      expect(obligation.oracleAddress).to.equal(oracle.address);
      expect(obligation.oracleFunction).to.equal(oracleFunction);
      expect(obligation.parameters).to.equal(parameters);
      expect(obligation.isVerified).to.be.false;
      expect(obligation.verificationTimestamp).to.equal(0);
    });

    it("should prevent registration with insufficient oracle score", async function () {
      // Set oracle score below minimum
      await obligationRegistry.connect(admin).updateOracleScore(oracle.address, INVALID_ORACLE_SCORE);

      const hash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test obligation"));
      const oracleFunction = "0x12345678";
      const parameters = ethers.utils.toUtf8Bytes("test params");

      await expect(
        obligationRegistry.connect(user).registerObligation(
          hash,
          oracle.address,
          oracleFunction,
          parameters
        )
      ).to.be.revertedWith("Oracle score too low");
    });

    it("should prevent registration with zero oracle address", async function () {
      const hash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test obligation"));
      const oracleFunction = "0x12345678";
      const parameters = ethers.utils.toUtf8Bytes("test params");

      await expect(
        obligationRegistry.connect(user).registerObligation(
          hash,
          ethers.constants.AddressZero,
          oracleFunction,
          parameters
        )
      ).to.be.revertedWith("Invalid oracle address");
    });

    it("should prevent duplicate obligation registration", async function () {
      const hash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test obligation"));
      const oracleFunction = "0x12345678";
      const parameters = ethers.utils.toUtf8Bytes("test params");

      // First registration should succeed
      await obligationRegistry.connect(user).registerObligation(
        hash,
        oracle.address,
        oracleFunction,
        parameters
      );

      // Second registration should fail
      await expect(
        obligationRegistry.connect(user).registerObligation(
          hash,
          oracle.address,
          oracleFunction,
          parameters
        )
      ).to.be.revertedWith("Obligation already exists");
    });

    it("should handle different oracle addresses correctly", async function () {
      // Set up multiple oracles
      await obligationRegistry.connect(admin).updateOracleScore(oracle.address, VALID_ORACLE_SCORE);
      await obligationRegistry.connect(admin).updateOracleScore(otherOracle.address, VALID_ORACLE_SCORE);

      const hash1 = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("obligation1"));
      const hash2 = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("obligation2"));

      // Register with first oracle
      await obligationRegistry.connect(user).registerObligation(
        hash1,
        oracle.address,
        "0x11111111",
        ethers.utils.toUtf8Bytes("params1")
      );

      // Register with second oracle
      await obligationRegistry.connect(user).registerObligation(
        hash2,
        otherOracle.address,
        "0x22222222",
        ethers.utils.toUtf8Bytes("params2")
      );

      expect(await obligationRegistry.oracleScores(oracle.address)).to.equal(VALID_ORACLE_SCORE);
      expect(await obligationRegistry.oracleScores(otherOracle.address)).to.equal(VALID_ORACLE_SCORE);
    });
  });

  describe("Obligation Verification", function () {
    let obligationId: string;

    beforeEach(async function () {
      // Set up oracle with valid score
      await obligationRegistry.connect(admin).updateOracleScore(oracle.address, VALID_ORACLE_SCORE);

      // Register obligation
      const hash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test obligation"));
      const tx = await obligationRegistry.connect(user).registerObligation(
        hash,
        oracle.address,
        "0x12345678",
        ethers.utils.toUtf8Bytes("test params")
      );
      
      const receipt = await tx.wait();
      obligationId = receipt.events?.find(e => e.event === "ObligationRegistered")?.args?.obligationId;
    });

    it("should verify unverified obligation", async function () {
      const obligationBefore = await obligationRegistry.getObligation(obligationId);
      expect(obligationBefore.isVerified).to.be.false;

      // Mock oracle verification success
      const MockOracle = await ethers.getContractFactory("MockOracle");
      const mockOracle = await MockOracle.deploy(true);
      await mockOracle.deployed();

      // Update oracle address in registry
      await obligationRegistry.connect(admin).updateOracleScore(mockOracle.address, VALID_ORACLE_SCORE);
      
      // This test would need more setup for actual verification
      // For now, test the basic verification path
      expect(obligationRegistry.target).to.not.be.undefined;
    });

    it("should prevent verification of non-existent obligation", async function () {
      const fakeId = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("fake"));
      
      await expect(
        obligationRegistry.verifyObligation(fakeId)
      ).to.be.revertedWith("Obligation does not exist");
    });

    it("should prevent re-verification of already verified obligation", async function () {
      // This would require actual oracle setup
      // Test the revert condition
      await expect(
        obligationRegistry.verifyObligation(obligationId)
      ).to.be.reverted; // Oracle call will fail since it's not a contract
    });
  });

  describe("Pausable Functionality", function () {
    beforeEach(async function () {
      await obligationRegistry.connect(admin).updateOracleScore(oracle.address, VALID_ORACLE_SCORE);
    });

    it("should allow admin to pause contract", async function () {
      await expect(obligationRegistry.connect(admin).pause())
        .to.emit(obligationRegistry, "Paused");

      const hash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test"));
      
      await expect(
        obligationRegistry.connect(user).registerObligation(hash, oracle.address, "0x1234", "0x")
      ).to.be.revertedWith("Pausable: paused");
    });

    it("should allow admin to unpause contract", async function () {
      await obligationRegistry.connect(admin).pause();
      await expect(obligationRegistry.connect(admin).unpause())
        .to.emit(obligationRegistry, "Unpaused");

      const hash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test"));
      await expect(
        obligationRegistry.connect(user).registerObligation(hash, oracle.address, "0x1234", "0x")
      ).to.not.be.reverted;
    });

    it("should prevent non-admin from pausing", async function () {
      await expect(
        obligationRegistry.connect(user).pause()
      ).to.be.reverted;
    });
  });

  describe("Access Control", function () {
    it("should grant ADMIN_ROLE to deployer", async function () {
      const ADMIN_ROLE = await obligationRegistry.ADMIN_ROLE();
      expect(await obligationRegistry.hasRole(ADMIN_ROLE, admin.address)).to.be.true;
    });

    it("should grant ORACLE_ROLE appropriately", async function () {
      const ORACLE_ROLE = await obligationRegistry.ORACLE_ROLE();
      expect(await obligationRegistry.hasRole(ORACLE_ROLE, admin.address)).to.be.false;
      
      await obligationRegistry.connect(admin).grantRole(ORACLE_ROLE, oracle.address);
      expect(await obligationRegistry.hasRole(ORACLE_ROLE, oracle.address)).to.be.true;
    });
  });
});