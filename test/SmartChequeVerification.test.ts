import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { keccak256, toUtf8Bytes } from "ethers";

describe("SmartChequeEscrow Verification Tests", function () {
  let escrow: any;
  let mockRegistry: any;
  let buyer: SignerWithAddress;
  let seller: SignerWithAddress;
  let token: any;

  const totalAmount = 1000;
  const milestones = [
    { amount: 400, obligation: keccak256(toUtf8Bytes("milestone1")) },
    { amount: 300, obligation: keccak256(toUtf8Bytes("milestone2")) },
    { amount: 300, obligation: keccak256(toUtf8Bytes("milestone3")) }
  ];

  beforeEach(async function () {
    [buyer, seller] = await ethers.getSigners();

    // Deploy mock ERC20 token
    const Token = await ethers.getContractFactory("MockERC20");
    token = await Token.deploy("Test Token", "TEST", totalAmount);

    // Deploy mock obligation registry
    const MockRegistry = await ethers.getContractFactory("MockObligationRegistry");
    mockRegistry = await MockRegistry.deploy();

    // Deploy SmartChequeEscrow
    const SmartChequeEscrow = await ethers.getContractFactory("SmartChequeEscrow");
    escrow = await SmartChequeEscrow.deploy();

    // Initialize escrow
    await escrow.initialize(
      buyer.address,
      seller.address,
      totalAmount,
      milestones.map(m => m.amount),
      milestones.map(m => m.obligation)
    );

    // Set obligation registry
    await escrow.connect(buyer).setObligationRegistry(await mockRegistry.getAddress());

    // Transfer tokens to buyer and approve escrow
    await token.transfer(buyer.address, totalAmount);
    await token.connect(buyer).approve(escrow.address, totalAmount);

    // Lock funds
    await escrow.connect(buyer).lockFunds(token.address);
  });

  describe("Milestone Verification via Obligation Registry", function () {
    it("should verify milestone when obligation is already verified", async function () {
      // Mark obligation as already verified
      await mockRegistry.setVerified(milestones[0].obligation, true);

      const proof = toUtf8Bytes("proof");
      
      await expect(escrow.connect(seller).completeMilestone(0, proof))
        .to.emit(escrow, "MilestoneVerification")
        .withArgs(0, milestones[0].obligation, true, keccak256(proof));

      const milestone = await escrow.getMilestone(0);
      expect(milestone.isCompleted).to.be.true;
    });

    it("should verify milestone when obligation needs verification", async function () {
      // Mark obligation as not verified
      await mockRegistry.setVerified(milestones[0].obligation, false);
      await mockRegistry.setVerificationResult(milestones[0].obligation, true);

      const proof = toUtf8Bytes("proof");
      
      await expect(escrow.connect(seller).completeMilestone(0, proof))
        .to.emit(escrow, "MilestoneVerification")
        .withArgs(0, milestones[0].obligation, true, keccak256(proof));

      const milestone = await escrow.getMilestone(0);
      expect(milestone.isCompleted).to.be.true;
    });

    it("should fail verification when obligation verification fails", async function () {
      // Mark obligation as not verified
      await mockRegistry.setVerified(milestones[0].obligation, false);
      await mockRegistry.setVerificationResult(milestones[0].obligation, false);

      const proof = toUtf8Bytes("proof");
      
      await expect(escrow.connect(seller).completeMilestone(0, proof))
        .to.be.revertedWith("Invalid milestone proof");

      const milestone = await escrow.getMilestone(0);
      expect(milestone.isCompleted).to.be.false;
    });

    it("should verify milestone when no obligation registry is set", async function () {
      // Create new escrow without obligation registry
      const newEscrow = await SmartChequeEscrow.deploy();
      await newEscrow.deployed();

      await newEscrow.initialize(
        buyer.address,
        seller.address,
        totalAmount,
        [totalAmount],
        [milestones[0].obligation]
      );

      await token.connect(buyer).approve(newEscrow.address, totalAmount);
      await newEscrow.connect(buyer).lockFunds(token.address);

      const proof = toUtf8Bytes("proof");
      
      // Should succeed because no registry means automatic verification
        await expect(newEscrow.connect(seller).completeMilestone(0, proof))
        .to.emit(newEscrow, "MilestoneVerification")
        .withArgs(0, milestones[0].obligation, true, keccak256(proof));
    });

    it("should emit MilestoneVerification event with correct parameters", async function () {
      const proof = toUtf8Bytes("test proof data");
      const expectedProofHash = keccak256(proof);

      await expect(escrow.connect(seller).completeMilestone(0, proof))
        .to.emit(escrow, "MilestoneVerification")
        .withArgs(0, milestones[0].obligation, true, expectedProofHash);
    });
  });

  describe("Milestone Completion Flow", function () {
    it("should complete milestone and release funds", async function () {
      const initialSellerBalance = await token.balanceOf(seller.address);
      const milestoneAmount = milestones[0].amount;

      const proof = toUtf8Bytes("proof");
      
      await expect(escrow.connect(seller).completeMilestone(0, proof))
        .to.emit(escrow, "MilestoneCompleted")
        .withArgs(0, milestoneAmount);

      const finalSellerBalance = await token.balanceOf(seller.address);
      expect(finalSellerBalance).to.equal(initialSellerBalance + BigInt(milestoneAmount));

      const milestone = await escrow.getMilestone(0);
      expect(milestone.isCompleted).to.be.true;
    });

    it("should complete all milestones and finalize contract", async function () {
      const proof = toUtf8Bytes("proof");

      // Complete all milestones
      for (let i = 0; i < milestones.length; i++) {
        await escrow.connect(seller).completeMilestone(i, proof);
      }

      expect(await escrow.isFinalized()).to.be.true;
    });

    it("should prevent completion of already completed milestone", async function () {
      const proof = toUtf8Bytes("proof");
      
      await escrow.connect(seller).completeMilestone(0, proof);

      await expect(escrow.connect(seller).completeMilestone(0, proof))
        .to.be.revertedWith("Milestone already completed");
    });

    it("should prevent completion of disputed milestone", async function () {
      // Raise dispute
      await escrow.connect(buyer).raiseDispute(0);

      const proof = toUtf8Bytes("proof");
      
      await expect(escrow.connect(seller).completeMilestone(0, proof))
        .to.be.revertedWith("Milestone is disputed");
    });

    it("should prevent completion when funds not locked", async function () {
      // Create new escrow without locking funds
      const newEscrow = await SmartChequeEscrow.deploy();
      await newEscrow.deployed();

      await newEscrow.initialize(
        buyer.target,
        seller.target,
        totalAmount,
        [totalAmount],
        [milestones[0].obligation]
      );

      const proof = toUtf8Bytes("proof");
      
      await expect(newEscrow.connect(seller).completeMilestone(0, proof))
        .to.be.revertedWith("Funds not locked");
    });

    it("should prevent completion when contract is finalized", async function () {
      const proof = toUtf8Bytes("proof");

      // Complete all milestones to finalize
      for (let i = 0; i < milestones.length; i++) {
        await escrow.connect(seller).completeMilestone(i, proof);
      }

      await expect(escrow.connect(seller).completeMilestone(0, proof))
        .to.be.revertedWith("Contract is finalized");
    });
  });

  describe("Edge Cases and Error Handling", function () {
    it("should handle empty proof data", async function () {
      const emptyProof = "0x";
      
      await expect(escrow.connect(seller).completeMilestone(0, emptyProof))
        .to.emit(escrow, "MilestoneVerification")
        .withArgs(0, milestones[0].obligation, true, keccak256(emptyProof));
    });

    it("should handle large proof data", async function () {
      const largeProof = ethers.utils.hexlify(ethers.utils.randomBytes(1000));
      
      await expect(escrow.connect(seller).completeMilestone(0, largeProof))
        .to.emit(escrow, "MilestoneVerification")
        .withArgs(0, milestones[0].obligation, true, keccak256(largeProof));
    });

    it("should handle invalid milestone index", async function () {
      const proof = toUtf8Bytes("proof");
      
      await expect(escrow.connect(seller).completeMilestone(999, proof))
        .to.be.revertedWith("Invalid milestone index");
    });
  });

  describe("Obligation Registry Integration", function () {
    it("should query obligation registry correctly", async function () {
      const obligationId = milestones[0].obligation;
      
      // Call getObligation to ensure proper integration
      const result = await mockRegistry.getObligation(obligationId);
      expect(result[4]).to.be.false; // isVerified should be false initially
    });

    it("should handle registry reverting during verification", async function () {
      await mockRegistry.setRevertOnVerify(true);

      const proof = toUtf8Bytes("proof");
      
      await expect(escrow.connect(seller).completeMilestone(0, proof))
        .to.be.revertedWith("Invalid milestone proof");
    });

    it("should handle registry returning false during verification", async function () {
      await mockRegistry.setVerificationResult(milestones[0].obligation, false);

      const proof = toUtf8Bytes("proof");
      
      await expect(escrow.connect(seller).completeMilestone(0, proof))
        .to.be.revertedWith("Invalid milestone proof");
    });
  });
});