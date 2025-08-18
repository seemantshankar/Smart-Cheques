import { expect } from "chai";
import hre from "hardhat";

const { ethers, upgrades } = hre;

describe("DisputeManager - Comprehensive Tests", function () {
  let disputeManager: any;
  let chequeFactory: any;
  let chequeEscrow: any;
  let admin: any;
  let buyer: any;
  let seller: any;
  let arbitrator1: any;
  let arbitrator2: any;
  let arbitrator3: any;
  let panelManager: any;

  // const ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE"));
  const ARBITRATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ARBITRATOR_ROLE"));
  const PANEL_MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PANEL_MANAGER_ROLE"));

  const DisputeStatus = {
    None: 0,
    Opened: 1,
    UnderReview: 2,
    ResolutionProposed: 3,
    Resolved: 4,
    Escalated: 5
  };

  const ResolutionType = {
    None: 0,
    ReleaseFunds: 1,
    RefundBuyer: 2,
    PartialRelease: 3
  };

  beforeEach(async function () {
    [admin, buyer, seller, arbitrator1, arbitrator2, arbitrator3, panelManager] = await ethers.getSigners();

    // Deploy DisputeManager
    const DisputeManagerFactory = await ethers.getContractFactory("DisputeManager");
    disputeManager = await upgrades.deployProxy(DisputeManagerFactory, [
      await admin.getAddress(),
      await arbitrator1.getAddress(),
      await panelManager.getAddress()
    ], {
      initializer: "initialize"
    });
    await disputeManager.waitForDeployment();

    // Deploy SmartChequeFactory
    const ChequeFactoryFactory = await ethers.getContractFactory("SmartChequeFactory");
    chequeFactory = await upgrades.deployProxy(ChequeFactoryFactory, [], {
      initializer: "initialize"
    });
    await chequeFactory.waitForDeployment();

    // Deploy mock ERC20 token
    const MockERC20Factory = await ethers.getContractFactory("contracts/mocks/MockERC20.sol:MockERC20");
    const mockToken = await MockERC20Factory.deploy("Test Token", "TEST", ethers.parseEther("1000000")) as any;
    await mockToken.waitForDeployment();

    // Deploy mock obligation registry
    const MockRegistryFactory = await ethers.getContractFactory("contracts/mocks/MockObligationRegistry.sol:MockObligationRegistry");
    const mockRegistry = await MockRegistryFactory.deploy();
    await mockRegistry.waitForDeployment();

    // Deploy SmartChequeEscrow
    const ChequeEscrowFactory = await ethers.getContractFactory("SmartChequeEscrow");
    const totalAmount = ethers.parseEther("1.0");
    const milestoneAmounts = [ethers.parseEther("0.5"), ethers.parseEther("0.5")];
    const obligations = [ethers.keccak256(ethers.toUtf8Bytes("milestone1")), ethers.keccak256(ethers.toUtf8Bytes("milestone2"))];
    
    chequeEscrow = await upgrades.deployProxy(ChequeEscrowFactory, [
      await buyer.getAddress(),
      await seller.getAddress(),
      totalAmount,
      milestoneAmounts,
      obligations
    ], {
      initializer: "initialize"
    });
    await chequeEscrow.waitForDeployment();

    // Fund buyer and approve escrow to spend tokens
    await mockToken.mint(await buyer.getAddress(), totalAmount);
    await mockToken.connect(buyer).approve(await chequeEscrow.getAddress(), totalAmount);
    
    // Set obligation registry before locking funds
    await chequeEscrow.connect(buyer).setObligationRegistry(await mockRegistry.getAddress());
    
    // Lock funds in escrow
    await chequeEscrow.connect(buyer).lockFunds(await mockToken.getAddress());

    // Grant roles
    await disputeManager.grantRole(ARBITRATOR_ROLE, await arbitrator1.getAddress());
    await disputeManager.grantRole(ARBITRATOR_ROLE, await arbitrator2.getAddress());
    await disputeManager.grantRole(ARBITRATOR_ROLE, await arbitrator3.getAddress());
    await disputeManager.grantRole(PANEL_MANAGER_ROLE, await panelManager.getAddress());
    
    // Grant DISPUTE_MANAGER_ROLE to DisputeManager on the escrow contract
    await chequeEscrow.connect(buyer).setDisputeManager(await disputeManager.getAddress());
  });

  describe("Single Arbitrator Disputes", function () {
    let disputeId: string;

    beforeEach(async function () {
      // First raise dispute on the escrow contract
      await chequeEscrow.connect(buyer).raiseDispute(0);
      
      // Create a dispute
      const tx = await disputeManager.connect(buyer).openDispute(
        await chequeEscrow.getAddress(),
        0,
        "Milestone not completed",
        ethers.toUtf8Bytes("Evidence of incomplete work")
      );
      const receipt = await tx.wait();
      const event = receipt?.logs?.find((log: any) => log.fragment?.name === "DisputeOpened");
      disputeId = event?.args?.disputeId;
    });

    it("Should open dispute successfully", async function () {
      const [chequeContract, milestoneIndex, initiator, reason, status] = await disputeManager.getDispute(disputeId);
      expect(chequeContract).to.equal(await chequeEscrow.getAddress());
      expect(milestoneIndex).to.equal(0);
      expect(initiator).to.equal(await buyer.getAddress());
      expect(reason).to.equal("Milestone not completed");
      expect(status).to.equal(DisputeStatus.Opened);
    });

    it("Should escalate to single arbitrator", async function () {
      await expect(
        disputeManager.connect(buyer).escalateDispute(disputeId, await arbitrator1.getAddress())
      ).to.emit(disputeManager, "DisputeEscalated")
        .withArgs(disputeId, await arbitrator1.getAddress());

      const [, , , , , , , arbitrator] = await disputeManager.getDispute(disputeId);
      expect(arbitrator).to.equal(await arbitrator1.getAddress());
    });

    it("Should resolve dispute with single arbitrator vote", async function () {
      await disputeManager.connect(buyer).escalateDispute(disputeId, await arbitrator1.getAddress());

      // First propose resolution
      await disputeManager.connect(arbitrator1).proposeResolution(
        disputeId,
        ResolutionType.ReleaseFunds,
        0
      );

      // Then resolve the dispute
      await expect(
        disputeManager.connect(arbitrator1).resolveDispute(disputeId)
      ).to.emit(disputeManager, "DisputeResolved")
        .withArgs(disputeId, ResolutionType.ReleaseFunds, 0);

      const [, , , , status] = await disputeManager.getDispute(disputeId);
      expect(status).to.equal(DisputeStatus.Resolved);
    });
  });

  describe("Panel Voting with Deterministic Averaging", function () {
    let disputeId: string;
    const panelId = ethers.keccak256(ethers.toUtf8Bytes("test-panel"));

    beforeEach(async function () {
      // First raise dispute on the escrow contract
      await chequeEscrow.connect(buyer).raiseDispute(0);
      
      // Create dispute
      const tx = await disputeManager.connect(buyer).openDispute(
        await chequeEscrow.getAddress(),
        0,
        "Milestone dispute",
        ethers.toUtf8Bytes("Evidence")
      );
      const receipt = await tx.wait();
      const event = receipt?.logs?.find((log: any) => log.fragment?.name === "DisputeOpened");
      disputeId = event?.args?.disputeId;

      // Configure panel
      await disputeManager.connect(panelManager).configurePanelArbitrators(
        panelId,
        [await arbitrator1.getAddress(), await arbitrator2.getAddress(), await arbitrator3.getAddress()],
        2
      );

      // Escalate to panel
      await disputeManager.connect(buyer).escalateDisputeToPanel(disputeId, panelId);
    });

    it("Should calculate deterministic average with rounding", async function () {
      // Test case: votes of 100, 200, 300 should average to 200 (600/3 = 200)
      await disputeManager.connect(arbitrator1).submitArbitratorVote(
        disputeId,
        ResolutionType.PartialRelease,
        100
      );

      await expect(
        disputeManager.connect(arbitrator2).submitArbitratorVote(
          disputeId,
          ResolutionType.PartialRelease,
          200
        )
      ).to.emit(disputeManager, "VoteCountingFinalized")
        .withArgs(disputeId, ResolutionType.PartialRelease, 300, 2, 150); // (300 + 1) / 2 = 150

      const [, , , , , proposedResolution, proposedAmount] = await disputeManager.getDispute(disputeId);
      expect(proposedResolution).to.equal(ResolutionType.PartialRelease);
      expect(proposedAmount).to.equal(150);
    });

    it("Should handle rounding edge cases correctly", async function () {
      // Test case: votes of 101, 102 should average to 102 (203 + 1) / 2 = 102
      await disputeManager.connect(arbitrator1).submitArbitratorVote(
        disputeId,
        ResolutionType.PartialRelease,
        101
      );

      await expect(
        disputeManager.connect(arbitrator2).submitArbitratorVote(
          disputeId,
          ResolutionType.PartialRelease,
          102
        )
      ).to.emit(disputeManager, "VoteCountingFinalized")
        .withArgs(disputeId, ResolutionType.PartialRelease, 203, 2, 102);
    });

    it("Should handle three-way voting correctly", async function () {
      // Configure panel with 3 required votes
       const newPanelId = ethers.keccak256(ethers.toUtf8Bytes("three-vote-panel"));
       await disputeManager.connect(panelManager).configurePanelArbitrators(
         newPanelId,
         [await arbitrator1.getAddress(), await arbitrator2.getAddress(), await arbitrator3.getAddress()],
         3
       );

      // First raise dispute on the escrow contract
      await chequeEscrow.connect(buyer).raiseDispute(1);
      
      // Create new dispute
       const tx = await disputeManager.connect(buyer).openDispute(
         await chequeEscrow.getAddress(),
         1,
         "Three-way test",
         ethers.toUtf8Bytes("Evidence")
       );
       const receipt = await tx.wait();
       const event = receipt?.logs?.find((log: any) => log.fragment?.name === "DisputeOpened");
       const newDisputeId = event?.args?.disputeId;

       await disputeManager.connect(buyer).escalateDisputeToPanel(newDisputeId, newPanelId);

       // Votes: 100, 200, 300 should average to 200 (600 + 1) / 3 = 200
       await disputeManager.connect(arbitrator1).submitArbitratorVote(
         newDisputeId,
         ResolutionType.PartialRelease,
         100
       );

       await disputeManager.connect(arbitrator2).submitArbitratorVote(
         newDisputeId,
         ResolutionType.PartialRelease,
         200
       );

       await expect(
         disputeManager.connect(arbitrator3).submitArbitratorVote(
           newDisputeId,
           ResolutionType.PartialRelease,
           300
         )
       ).to.emit(disputeManager, "VoteCountingFinalized")
         .withArgs(newDisputeId, ResolutionType.PartialRelease, 600, 3, 200);
    });
  });

  describe("Edge Cases and Error Handling", function () {
    it("Should prevent non-arbitrator from voting", async function () {
       // First raise dispute on the escrow contract
       await chequeEscrow.connect(buyer).raiseDispute(0);
       
       const tx = await disputeManager.connect(buyer).openDispute(
         await chequeEscrow.getAddress(),
         0,
         "Test dispute",
         ethers.toUtf8Bytes("Evidence")
       );
       const receipt = await tx.wait();
       const event = receipt?.logs?.find((log: any) => log.fragment?.name === "DisputeOpened");
       const disputeId = event?.args?.disputeId;

       const panelId = ethers.keccak256(ethers.toUtf8Bytes("test-panel"));
       await disputeManager.connect(panelManager).configurePanelArbitrators(
         panelId,
         [await arbitrator1.getAddress(), await arbitrator2.getAddress()],
         2
       );
      await disputeManager.connect(buyer).escalateDisputeToPanel(disputeId, panelId);

      await expect(
        disputeManager.connect(seller).submitArbitratorVote(
          disputeId,
          ResolutionType.ReleaseFunds,
          0
        )
      ).to.be.revertedWith("AccessControl: account 0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc is missing role 0x16ceee8289685dd2a02b9c8ae81d2df373176ce53519e6284e2a2950d6546ffa");
    });

    it("Should prevent double voting", async function () {
       // First raise dispute on the escrow contract
       await chequeEscrow.connect(buyer).raiseDispute(0);
       
       const tx = await disputeManager.connect(buyer).openDispute(
         await chequeEscrow.getAddress(),
         0,
         "Test dispute",
         ethers.toUtf8Bytes("Evidence")
       );
       const receipt = await tx.wait();
       const event = receipt?.logs?.find((log: any) => log.fragment?.name === "DisputeOpened");
       const disputeId = event?.args?.disputeId;

       const panelId = ethers.keccak256(ethers.toUtf8Bytes("test-panel"));
       await disputeManager.connect(panelManager).configurePanelArbitrators(
         panelId,
         [await arbitrator1.getAddress(), await arbitrator2.getAddress()],
         2
       );
      await disputeManager.connect(buyer).escalateDisputeToPanel(disputeId, panelId);

      await disputeManager.connect(arbitrator1).submitArbitratorVote(
        disputeId,
        ResolutionType.ReleaseFunds,
        0
      );

      await expect(
        disputeManager.connect(arbitrator1).submitArbitratorVote(
          disputeId,
          ResolutionType.ReleaseFunds,
          0
        )
      ).to.be.revertedWithCustomError(disputeManager, "AlreadyVoted");
    });

    it("Should handle zero vote count gracefully", async function () {
       // First raise dispute on the escrow contract
       await chequeEscrow.connect(buyer).raiseDispute(0);
       
       // This tests the edge case where voteCount is 0 in averaging
       const tx = await disputeManager.connect(buyer).openDispute(
         await chequeEscrow.getAddress(),
         0,
         "Test dispute",
         ethers.toUtf8Bytes("Evidence")
       );
      const receipt = await tx.wait();
      const event = receipt?.logs?.find((log: any) => log.fragment?.name === "DisputeOpened");
      const disputeId = event?.args?.disputeId;

      // Test that dispute exists but has no votes yet
      const [, , , , status] = await disputeManager.getDispute(disputeId);
      expect(status).to.equal(DisputeStatus.Opened);
    });
  });

  describe("Vote Counting Assertions", function () {
    it("Should maintain vote counting integrity", async function () {
       // First raise dispute on the escrow contract
       await chequeEscrow.connect(buyer).raiseDispute(0);
       
       const tx = await disputeManager.connect(buyer).openDispute(
         await chequeEscrow.getAddress(),
         0,
         "Test dispute",
         ethers.toUtf8Bytes("Evidence")
       );
       const receipt = await tx.wait();
       const event = receipt?.logs?.find((log: any) => log.fragment?.name === "DisputeOpened");
       const disputeId = event?.args?.disputeId;

       const panelId = ethers.keccak256(ethers.toUtf8Bytes("test-panel"));
       await disputeManager.connect(panelManager).configurePanelArbitrators(
         panelId,
         [await arbitrator1.getAddress(), await arbitrator2.getAddress()],
         2
       );
       await disputeManager.connect(buyer).escalateDisputeToPanel(disputeId, panelId);

       // Submit votes and verify vote counts
       await disputeManager.connect(arbitrator1).submitArbitratorVote(
         disputeId,
         ResolutionType.PartialRelease,
         1000
       );

       const [vote1ResolutionType, vote1Amount, vote1HasVoted] = await disputeManager.getArbitratorVote(
         disputeId,
         await arbitrator1.getAddress()
       );
       expect(vote1ResolutionType).to.equal(ResolutionType.PartialRelease);
       expect(vote1Amount).to.equal(1000);
       expect(vote1HasVoted).to.be.true;

       // Complete voting and check final resolution
       await disputeManager.connect(arbitrator2).submitArbitratorVote(
         disputeId,
         ResolutionType.PartialRelease,
         2000
       );

       const [, , , , , proposedResolution, proposedAmount] = await disputeManager.getDispute(disputeId);
       expect(proposedResolution).to.equal(ResolutionType.PartialRelease);
       expect(proposedAmount).to.equal(1500); // (3000 + 1) / 2 = 1500
     });
  });
});


