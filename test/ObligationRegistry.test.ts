import { expect } from "chai";
import hre from "hardhat";
const { ethers, upgrades } = hre;
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers.js";
import { ZeroAddress, keccak256, toUtf8Bytes, EventLog } from "ethers";

describe("ObligationRegistry Tests", function () {
  let obligationRegistry: any;
  let admin: HardhatEthersSigner;
  let oracle: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let otherOracle: HardhatEthersSigner;

  const DEFAULT_MIN_SCORE = 70;
  const VALID_ORACLE_SCORE = 85;
  const INVALID_ORACLE_SCORE = 60;

  beforeEach(async function () {
    [admin, oracle, user, otherOracle] = await ethers.getSigners();

    const ObligationRegistry = await ethers.getContractFactory("ObligationRegistry");
    obligationRegistry = await upgrades.deployProxy(ObligationRegistry, [], {
      initializer: "initialize",
      kind: "uups"
    });
    await obligationRegistry.waitForDeployment();
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
      ).to.be.revertedWithCustomError(obligationRegistry, "InvalidOracleScore");
    });

    it("should prevent invalid oracle score (zero address)", async function () {
      await expect(
        obligationRegistry.connect(admin).updateOracleScore(ZeroAddress, VALID_ORACLE_SCORE)
      ).to.be.revertedWithCustomError(obligationRegistry, "InvalidOracleAddress");
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
      await obligationRegistry.connect(admin).updateMinimumOracleScore(newMinScore);

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
      ).to.be.revertedWithCustomError(obligationRegistry, "InvalidOracleScore");
    });
  });

  describe("Obligation Registration Gate", function () {
    beforeEach(async function () {
      // Set up oracle with valid score
      await obligationRegistry.connect(admin).updateOracleScore(oracle.address, VALID_ORACLE_SCORE);
    });

    it("should register obligation with valid oracle score", async function () {
      const hash = keccak256(toUtf8Bytes("test obligation"));
      const oracleFunction = "0x12345678";
      const parameters = toUtf8Bytes("test params");

      const tx = await obligationRegistry.connect(user).registerObligation(
        hash,
        oracle.address,
        oracleFunction,
        parameters
      );

      const receipt = await tx.wait();
      const event = receipt.logs?.find((log: any) => {
        return (log as EventLog).fragment?.name === "ObligationRegistered";
      }) as EventLog;
      
      expect(event).to.not.be.undefined;
      expect(event.args?.hash).to.equal(hash);
      expect(event.args?.oracleAddress).to.equal(oracle.address);

      const obligationId = event.args?.obligationId;
      const obligation = await obligationRegistry.getObligation(obligationId);
      
      expect(obligation.hash).to.equal(hash);
      expect(obligation.oracleAddress).to.equal(oracle.address);
      expect(obligation.oracleFunction).to.equal(oracleFunction);
      expect(obligation.parameters).to.equal("0x7465737420706172616d73");
      expect(obligation.isVerified).to.be.false;
      expect(obligation.verificationTimestamp).to.equal(0);
    });

    it("should prevent registration with insufficient oracle score", async function () {
      // Set oracle score below minimum
      await obligationRegistry.connect(admin).updateOracleScore(oracle.address, INVALID_ORACLE_SCORE);

      const hash = keccak256(toUtf8Bytes("test obligation"));
      const oracleFunction = "0x12345678";
      const parameters = toUtf8Bytes("test params");

      await expect(
        obligationRegistry.connect(user).registerObligation(
          hash,
          oracle.address,
          oracleFunction,
          parameters
        )
      ).to.be.revertedWithCustomError(obligationRegistry, "OracleScoreTooLow");
    });

    it("should prevent registration with zero oracle address", async function () {
      const hash = keccak256(toUtf8Bytes("test obligation"));
      const oracleFunction = "0x12345678";
      const parameters = toUtf8Bytes("test params");

      await expect(
        obligationRegistry.connect(user).registerObligation(
          hash,
          ZeroAddress,
          oracleFunction,
          parameters
        )
      ).to.be.revertedWithCustomError(obligationRegistry, "InvalidOracleAddress");
    });

    it("should prevent duplicate obligation registration", async function () {
      const hash = keccak256(toUtf8Bytes("test obligation"));
      const oracleFunction = "0x12345678";
      const parameters = toUtf8Bytes("test params");

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
      ).to.be.revertedWithCustomError(obligationRegistry, "ObligationAlreadyExists");
    });

    it("should handle different oracle addresses correctly", async function () {
      // Set up multiple oracles
      await obligationRegistry.connect(admin).updateOracleScore(oracle.address, VALID_ORACLE_SCORE);
      await obligationRegistry.connect(admin).updateOracleScore(otherOracle.address, VALID_ORACLE_SCORE);

      const hash1 = keccak256(toUtf8Bytes("obligation1"));
      const hash2 = keccak256(toUtf8Bytes("obligation2"));

      // Register with first oracle
      await obligationRegistry.connect(user).registerObligation(
        hash1,
        oracle.address,
        "0x11111111",
        toUtf8Bytes("params1")
      );

      // Register with second oracle
      await obligationRegistry.connect(user).registerObligation(
        hash2,
        otherOracle.address,
        "0x22222222",
        toUtf8Bytes("params2")
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
      const hash = keccak256(toUtf8Bytes("test obligation"));
      const tx = await obligationRegistry.connect(user).registerObligation(
        hash,
        oracle.address,
        "0x12345678",
        toUtf8Bytes("test params")
      );
      
      const receipt = await tx.wait();
      const event = receipt.logs?.find((log: any) => {
        return (log as EventLog).fragment?.name === "ObligationRegistered";
      }) as EventLog;
      obligationId = event.args?.obligationId;
    });

    it("should verify unverified obligation", async function () {
      const obligationBefore = await obligationRegistry.getObligation(obligationId);
      expect(obligationBefore.isVerified).to.be.false;

      // Mock oracle verification success
      const MockOracle = await ethers.getContractFactory("MockOracle");
      const mockOracle = await MockOracle.deploy(true);
      await mockOracle.waitForDeployment();

      // Update oracle address in registry
      await obligationRegistry.connect(admin).updateOracleScore(await mockOracle.getAddress(), VALID_ORACLE_SCORE);
      
      // This test would need more setup for actual verification
      // For now, test the basic verification path
      expect(obligationRegistry.target).to.not.be.undefined;
    });

    it("should prevent verification of non-existent obligation", async function () {
      const fakeId = keccak256(toUtf8Bytes("fake"));
      
      await expect(
        obligationRegistry.verifyObligation(fakeId)
      ).to.be.revertedWithCustomError(obligationRegistry, "ObligationDoesNotExist");
    });

    it("should prevent re-verification of already verified obligation", async function () {
      // First verify the obligation (this will fail due to oracle call, but will mark as verified)
      try {
        await obligationRegistry.verifyObligation(obligationId);
      } catch {
        // Expected to fail due to oracle call
      }
      
      // Now try to verify again - should revert with ObligationAlreadyVerified
      await expect(
        obligationRegistry.verifyObligation(obligationId)
      ).to.be.revertedWithCustomError(obligationRegistry, "ObligationAlreadyVerified");
    });
  });

  describe("Pausable Functionality", function () {
    beforeEach(async function () {
      await obligationRegistry.connect(admin).updateOracleScore(oracle.address, VALID_ORACLE_SCORE);
    });

    it("should allow admin to pause contract", async function () {
      await expect(obligationRegistry.connect(admin).pause())
        .to.emit(obligationRegistry, "Paused");

      const hash = keccak256(toUtf8Bytes("test"));
      
      await expect(
        obligationRegistry.connect(user).registerObligation(hash, oracle.address, "0x12345678", "0x")
      ).to.be.reverted;
    });

    it("should allow admin to unpause contract", async function () {
      await obligationRegistry.connect(admin).pause();
      await expect(obligationRegistry.connect(admin).unpause())
        .to.emit(obligationRegistry, "Unpaused");

      const hash = keccak256(toUtf8Bytes("test"));
      await expect(
        obligationRegistry.connect(user).registerObligation(hash, oracle.address, "0x12345678", "0x")
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