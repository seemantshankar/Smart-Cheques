import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Contract, Event } from "ethers";
import { 
  SmartChequeFactory,
  SmartChequeEscrow,
  ObligationRegistry,
  DisputeManager,
  MockERC20
} from "../typechain";
import * as hre from "hardhat";

describe("Smart Cheque System", function () {
  let smartChequeFactory: SmartChequeFactory;
  let obligationRegistry: ObligationRegistry;
  let disputeManager: DisputeManager;
  let owner: SignerWithAddress;
  let buyer: SignerWithAddress;
  let seller: SignerWithAddress;
  let arbitrator: SignerWithAddress;

  const totalAmount = ethers.utils.parseEther("1");
  const milestones = [ethers.utils.parseEther("0.5"), ethers.utils.parseEther("0.5")];
  const obligations = [
    ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Milestone 1")),
    ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Milestone 2"))
  ];

  beforeEach(async function () {
    [owner, buyer, seller, arbitrator] = await ethers.getSigners();

    // Deploy SmartChequeFactory
    const SmartChequeFactoryContract = await ethers.getContractFactory("SmartChequeFactory");
    smartChequeFactory = (await hre.upgrades.deployProxy(SmartChequeFactoryContract, [], {
      initializer: "initialize",
      kind: "uups"
    })) as SmartChequeFactory;

    // Deploy ObligationRegistry
    const ObligationRegistryContract = await ethers.getContractFactory("ObligationRegistry");
    obligationRegistry = (await hre.upgrades.deployProxy(ObligationRegistryContract, [], {
      initializer: "initialize",
      kind: "uups"
    })) as ObligationRegistry;

    // Deploy DisputeManager
    const DisputeManagerContract = await ethers.getContractFactory("DisputeManager");
    disputeManager = (await hre.upgrades.deployProxy(DisputeManagerContract, [], {
      initializer: "initialize",
      kind: "uups"
    })) as DisputeManager;

    // Set up roles
    const OPERATOR_ROLE = await smartChequeFactory.OPERATOR_ROLE();
    const ORACLE_ROLE = await obligationRegistry.ORACLE_ROLE();
    const ARBITRATOR_ROLE = await disputeManager.ARBITRATOR_ROLE();

    await smartChequeFactory.grantRole(OPERATOR_ROLE, owner.address);
    await obligationRegistry.grantRole(ORACLE_ROLE, owner.address);
    await disputeManager.grantRole(ARBITRATOR_ROLE, arbitrator.address);
  });

  describe("SmartChequeFactory", function () {
    it("Should create a new Smart Cheque", async function () {
      const tx = await smartChequeFactory.createCheque(
        buyer.address,
        seller.address,
        totalAmount,
        milestones,
        obligations
      );

      const receipt = await tx.wait();
      const event = receipt.events?.find((e: Event) => e.event === "ChequeCreated");
      expect(event).to.not.be.undefined;

      const chequeId = event?.args?.chequeId;
      const chequeAddress = await smartChequeFactory.getChequeAddress(chequeId);
      expect(chequeAddress).to.not.equal(ethers.constants.AddressZero);
    });

    it("Should fail to create cheque with invalid parameters", async function () {
      await expect(
        smartChequeFactory.createCheque(
          ethers.constants.AddressZero,
          seller.address,
          totalAmount,
          milestones,
          obligations
        )
      ).to.be.revertedWith("Invalid buyer address");
    });
  });

  describe("SmartChequeEscrow", function () {
    let chequeId: string;
    let chequeAddress: string;
    let chequeContract: SmartChequeEscrow;

    beforeEach(async function () {
      const tx = await smartChequeFactory.createCheque(
        buyer.address,
        seller.address,
        totalAmount,
        milestones,
        obligations
      );

      const receipt = await tx.wait();
      const event = receipt.events?.find((e: Event) => e.event === "ChequeCreated");
      chequeId = event?.args?.chequeId;
      chequeAddress = await smartChequeFactory.getChequeAddress(chequeId);
      chequeContract = await ethers.getContractAt("SmartChequeEscrow", chequeAddress) as SmartChequeEscrow;
    });

    it("Should lock funds", async function () {
      // Deploy mock ERC20 token
      const MockTokenFactory = await ethers.getContractFactory("MockERC20");
      const token = (await MockTokenFactory.deploy("Mock Token", "MTK")) as MockERC20;
      await token.mint(buyer.address, totalAmount);

      // Approve and lock funds
      await token.connect(buyer).approve(chequeAddress, totalAmount);
      await chequeContract.connect(buyer).lockFunds(token.address);

      expect(await token.balanceOf(chequeAddress)).to.equal(totalAmount);
    });

    it("Should complete milestone", async function () {
      // Setup mock token and lock funds
      const MockTokenFactory = await ethers.getContractFactory("MockERC20");
      const token = (await MockTokenFactory.deploy("Mock Token", "MTK")) as MockERC20;
      await token.mint(buyer.address, totalAmount);
      await token.connect(buyer).approve(chequeAddress, totalAmount);
      await chequeContract.connect(buyer).lockFunds(token.address);

      // Complete milestone
      const proof = ethers.utils.defaultAbiCoder.encode(["string"], ["Proof"]);
      await chequeContract.completeMilestone(0, proof);

      const milestone = await chequeContract.getMilestone(0);
      expect(milestone.isCompleted).to.be.true;
    });
  });

  describe("DisputeManager", function () {
    let chequeId: string;
    let chequeAddress: string;
    let disputeId: string;

    beforeEach(async function () {
      const tx = await smartChequeFactory.createCheque(
        buyer.address,
        seller.address,
        totalAmount,
        milestones,
        obligations
      );

      const receipt = await tx.wait();
      const event = receipt.events?.find((e: Event) => e.event === "ChequeCreated");
      chequeId = event?.args?.chequeId;
      chequeAddress = await smartChequeFactory.getChequeAddress(chequeId);

      // Open dispute
      const openTx = await disputeManager.connect(buyer).openDispute(
        chequeAddress,
        0,
        "Milestone not completed",
        ethers.utils.defaultAbiCoder.encode(["string"], ["Evidence"])
      );

      const openReceipt = await openTx.wait();
      const openEvent = openReceipt.events?.find((e: Event) => e.event === "DisputeOpened");
      disputeId = openEvent?.args?.disputeId;
    });

    it("Should escalate dispute", async function () {
      await disputeManager.escalateDispute(disputeId, arbitrator.address);
      const dispute = await disputeManager.getDispute(disputeId);
      expect(dispute.arbitrator).to.equal(arbitrator.address);
      expect(dispute.status).to.equal(2); // DisputeStatus.UnderReview
    });

    it("Should resolve dispute", async function () {
      // Get the cheque contract instance
      const chequeContract = await ethers.getContractAt("SmartChequeEscrow", chequeAddress) as SmartChequeEscrow;

      // Setup mock token and lock funds
      const MockTokenFactory = await ethers.getContractFactory("MockERC20");
      const token = (await MockTokenFactory.deploy("Mock Token", "MTK")) as MockERC20;
      await token.mint(buyer.address, totalAmount);
      await token.connect(buyer).approve(chequeAddress, totalAmount);
      await chequeContract.connect(buyer).lockFunds(token.address);

      // Raise dispute in the escrow contract
      await chequeContract.connect(buyer).raiseDispute(0);

      // First escalate to assign arbitrator and set status to UnderReview
      await disputeManager.escalateDispute(disputeId, arbitrator.address);
      
      // Arbitrator proposes resolution
      await disputeManager.connect(arbitrator).proposeResolution(
        disputeId,
        1, // ResolutionType.ReleaseFunds
        0
      );

      // Resolve the dispute
      await disputeManager.connect(arbitrator).resolveDispute(disputeId);
      
      const dispute = await disputeManager.getDispute(disputeId);
      expect(dispute.status).to.equal(4); // DisputeStatus.Resolved

      // Verify the milestone dispute status
      const milestone = await chequeContract.getMilestone(0);
      expect(milestone.isDisputed).to.be.false;
      expect(milestone.isCompleted).to.be.true;
    });
  });
});