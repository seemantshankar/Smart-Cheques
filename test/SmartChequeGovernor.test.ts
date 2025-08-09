import { expect } from "chai";
import pkg from "hardhat";
const { ethers, upgrades } = pkg;
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers.js";
import { time } from "@nomicfoundation/hardhat-network-helpers";
// Using ethers.keccak256 and ethers.toUtf8Bytes for consistency
// Import contract types
type SmartChequeGovernor = any;
type SmartChequeTimelockController = any;
type GovernanceToken = any;
type SmartChequeEscrow = any;
type SmartChequeFactory = any;
type ObligationRegistry = any;

// Helper function to extract proposalId from transaction receipt
function extractProposalIdFromReceipt(receipt: any, iface: any) {
  for (const log of receipt.logs ?? []) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed && parsed.name === "ProposalCreated") return parsed.args.proposalId;
    } catch (e) { /* ignore */ }
  }
  console.error("Receipt logs:", receipt.logs);
  throw new Error("ProposalCreated log not found");
}

describe("SmartChequeGovernor Tests", function () {
  let governor: SmartChequeGovernor;
  let timelock: SmartChequeTimelockController;
  let governanceToken: GovernanceToken;
  let escrow: SmartChequeEscrow;
  let factory: SmartChequeFactory;
  let obligationRegistry: ObligationRegistry;

  let deployer: SignerWithAddress;
  let proposer: SignerWithAddress;
  let executor: SignerWithAddress;
  let voter1: SignerWithAddress;
  let voter2: SignerWithAddress;

  const VOTING_DELAY = 1; // blocks
  const VOTING_PERIOD = 5; // blocks (short for testing)
  const MIN_DELAY = 3600; // 1 hour
  const PROPOSAL_THRESHOLD = ethers.parseEther("1000"); // 1000 tokens
  const QUORUM_PERCENTAGE = 4; // 4%

  beforeEach(async function () {
    [deployer, proposer, executor, voter1, voter2] = await ethers.getSigners();

    // Deploy GovernanceToken
    const GovernanceTokenFactory = await ethers.getContractFactory("contracts/GovernanceToken.sol:GovernanceToken");
    governanceToken = await GovernanceTokenFactory.deploy();

    // Deploy Timelock
    const SmartChequeTimelockController = await ethers.getContractFactory("SmartChequeTimelockController");
    timelock = await SmartChequeTimelockController.deploy(
      MIN_DELAY,
      [proposer.address],
      [ethers.ZeroAddress], // Use zero address to allow anyone to execute
      deployer.address
    );

    // Deploy Governor
    const SmartChequeGovernor = await ethers.getContractFactory("SmartChequeGovernor");
    governor = await SmartChequeGovernor.deploy(
      await governanceToken.getAddress(),
      await timelock.getAddress(),
      PROPOSAL_THRESHOLD
    );

    // Deploy core contracts using upgrades proxy
    const SmartChequeEscrow = await ethers.getContractFactory("SmartChequeEscrow");
    escrow = await upgrades.deployProxy(SmartChequeEscrow, [
      await voter1.getAddress(),
      await voter2.getAddress(),
      1000,
      [500, 500],
      [ethers.keccak256(ethers.toUtf8Bytes("milestone1")), ethers.keccak256(ethers.toUtf8Bytes("milestone2"))]
    ], {
      initializer: "initialize"
    });

    const SmartChequeFactory = await ethers.getContractFactory("SmartChequeFactory");
    factory = await upgrades.deployProxy(SmartChequeFactory, [], {
      initializer: "initialize"
    });

    const ObligationRegistry = await ethers.getContractFactory("ObligationRegistry");
    obligationRegistry = await upgrades.deployProxy(ObligationRegistry, [], {
      initializer: "initialize"
    });

    // Setup roles - use voter1 (buyer) for escrow since they have DEFAULT_ADMIN_ROLE
    await escrow.connect(voter1).grantRole(await escrow.DEFAULT_ADMIN_ROLE(), await timelock.getAddress());
    await factory.grantRole(await factory.DEFAULT_ADMIN_ROLE(), await timelock.getAddress());
    await obligationRegistry.grantRole(await obligationRegistry.ADMIN_ROLE(), await timelock.getAddress());

    // Remove admin roles
    await escrow.connect(voter1).renounceRole(await escrow.DEFAULT_ADMIN_ROLE(), voter1.address);
    await factory.renounceRole(await factory.DEFAULT_ADMIN_ROLE(), deployer.address);
    await obligationRegistry.renounceRole(await obligationRegistry.ADMIN_ROLE(), deployer.address);

    // Setup governor as proposer
    await timelock.grantRole(await timelock.PROPOSER_ROLE(), await governor.getAddress());
    
    // Grant timelock executor role to itself (required for governance parameter changes)
    await timelock.grantRole(await timelock.EXECUTOR_ROLE(), await timelock.getAddress());
    
    // Grant timelock the ability to renounce its own roles (required for some governance operations)
    await timelock.grantRole(await timelock.DEFAULT_ADMIN_ROLE(), await timelock.getAddress());

    // Distribute governance tokens (transfer from deployer who received initial supply)
    // Need enough tokens to meet 4% quorum (4M tokens out of 100M total supply)
    await governanceToken.transfer(voter1.address, ethers.parseEther("3000000")); // 3M tokens
    await governanceToken.transfer(voter2.address, ethers.parseEther("2000000")); // 2M tokens
    // deployer retains the rest (95M tokens)

    // Delegate voting power
    await governanceToken.connect(voter1).delegate(voter1.address);
    await governanceToken.connect(voter2).delegate(voter2.address);
    await governanceToken.connect(deployer).delegate(deployer.address);
  });

  describe("Proposal Creation", function () {
    it("should create proposal with correct parameters", async function () {
      const newMinScore = 80;
      const calldata = obligationRegistry.interface.encodeFunctionData("updateMinimumOracleScore", [newMinScore]);

      const tx = await governor.connect(voter1).propose(
        [await obligationRegistry.getAddress()],
        [0],
        [calldata],
        "Update minimum oracle score to 80"
      );

      const receipt = await tx.wait();
      const proposalId = extractProposalIdFromReceipt(receipt, governor.interface);
      const actualProposer = await governor.proposalProposer(proposalId);
      expect(actualProposer).to.equal(voter1.address);
    });

    it("should prevent proposal without voting power", async function () {
      // Use proposer as nonVoter since they don't have any governance tokens
      const calldata = obligationRegistry.interface.encodeFunctionData("updateMinimumOracleScore", [80]);

      await expect(
        governor.connect(proposer).propose(
          [await obligationRegistry.getAddress()],
          [0],
          [calldata],
          "Test proposal"
        )
      ).to.be.revertedWith("Governor: proposer votes below proposal threshold");
    });
  });

  describe("Voting and Execution", function () {
    let proposalId: bigint;

    beforeEach(async function () {
      const calldata = obligationRegistry.interface.encodeFunctionData("updateMinimumOracleScore", [80]);
      
      const tx = await governor.connect(voter1).propose(
        [await obligationRegistry.getAddress()],
        [0],
        [calldata],
        "Update minimum oracle score to 80"
      );
      
      const receipt = await tx.wait();
      proposalId = extractProposalIdFromReceipt(receipt, governor.interface);
      
      // Wait for voting delay to pass
      await time.advanceBlockTo((await ethers.provider.getBlockNumber()) + VOTING_DELAY + 1);
    });

    it("should allow voting on active proposal", async function () {
      await governor.connect(voter1).castVote(proposalId, 1); // For
      await governor.connect(voter2).castVote(proposalId, 1); // For

      // Check vote counts using proposalVotes function
      const [againstVotes, forVotes, abstainVotes] = await governor.proposalVotes(proposalId);
      expect(BigInt(forVotes)).to.equal(BigInt(ethers.parseEther("5000000"))); // 3M + 2M tokens
    });

    it("should execute successful proposal", async function () {
      // Vote
      await governor.connect(voter1).castVote(proposalId, 1);
      await governor.connect(voter2).castVote(proposalId, 1);

      // Wait for voting period
      await time.advanceBlockTo((await ethers.provider.getBlockNumber()) + VOTING_PERIOD + 1);

      // Queue
      await governor.queue(
        [await obligationRegistry.getAddress()],
        [0],
        [obligationRegistry.interface.encodeFunctionData("updateMinimumOracleScore", [80])],
        ethers.keccak256(ethers.toUtf8Bytes("Update minimum oracle score to 80"))
      );

      // Wait for timelock delay
      await time.increase(MIN_DELAY + 1);
      await time.advanceBlock();
      await time.advanceBlock(); // extra block for safety

      // Execute
      await expect(
        governor.execute(
          [await obligationRegistry.getAddress()],
          [0],
          [obligationRegistry.interface.encodeFunctionData("updateMinimumOracleScore", [80])],
          ethers.keccak256(ethers.toUtf8Bytes("Update minimum oracle score to 80"))
        )
      ).to.emit(obligationRegistry, "MinimumOracleScoreUpdated").withArgs(80);

      expect(await obligationRegistry.minimumOracleScore()).to.equal(80);
    });

    it("should prevent execution of failed proposal", async function () {
      // Vote against
      await governor.connect(voter1).castVote(proposalId, 0); // Against
      await governor.connect(voter2).castVote(proposalId, 0); // Against

      await time.advanceBlockTo((await ethers.provider.getBlockNumber()) + VOTING_PERIOD + 1);

      await expect(
        governor.queue(
          [await obligationRegistry.getAddress()],
          [0],
          [obligationRegistry.interface.encodeFunctionData("updateMinimumOracleScore", [80])],
          ethers.keccak256(ethers.toUtf8Bytes("Update minimum oracle score to 80"))
        )
      ).to.be.revertedWith("Governor: proposal not successful");
    });
  });

  // Note: Contract upgrade tests removed as SmartChequeEscrow doesn't inherit from UUPSUpgradeable
  // and therefore doesn't have upgradeTo functionality

  describe("Emergency Pause/Unpause via Governance", function () {
    it("should pause contract via governance", async function () {
      const calldata = obligationRegistry.interface.encodeFunctionData("pause");
      
      const tx = await governor.connect(voter1).propose(
        [await obligationRegistry.getAddress()],
        [0],
        [calldata],
        "Emergency pause ObligationRegistry"
      );
      
      const receipt = await tx.wait();
      const proposalIdValue = extractProposalIdFromReceipt(receipt, governor.interface);

      // Wait for voting delay to pass
      await time.advanceBlockTo((await ethers.provider.getBlockNumber()) + VOTING_DELAY + 1);

      // Vote
      await governor.connect(voter1).castVote(proposalIdValue, 1);
      await governor.connect(voter2).castVote(proposalIdValue, 1);

      await time.advanceBlockTo((await ethers.provider.getBlockNumber()) + VOTING_PERIOD + 1);

      // Queue
      await governor.queue(
        [await obligationRegistry.getAddress()],
        [0],
        [calldata],
        ethers.keccak256(ethers.toUtf8Bytes("Emergency pause ObligationRegistry"))
      );

      await time.increase(MIN_DELAY + 1);
      await time.advanceBlock();
      await time.advanceBlock(); // extra block for safety

      await expect(
        governor.execute(
          [await obligationRegistry.getAddress()],
          [0],
          [calldata],
          ethers.keccak256(ethers.toUtf8Bytes("Emergency pause ObligationRegistry"))
        )
      ).to.emit(obligationRegistry, "Paused");

      expect(await obligationRegistry.paused()).to.be.true;
    });

    it("should unpause contract via governance", async function () {
      // First pause via governance
      const pauseCalldata = obligationRegistry.interface.encodeFunctionData("pause");
      
      const pauseTx = await governor.connect(voter1).propose(
        [await obligationRegistry.getAddress()],
        [0],
        [pauseCalldata],
        "Pause ObligationRegistry"
      );
      
      const pauseReceipt = await pauseTx.wait();
      const pauseProposalId = extractProposalIdFromReceipt(pauseReceipt, governor.interface);

      // Wait for voting delay to pass
      await time.advanceBlockTo((await ethers.provider.getBlockNumber()) + VOTING_DELAY + 1);

      // Vote on pause proposal
      await governor.connect(voter1).castVote(pauseProposalId, 1); // Vote "For"
      await governor.connect(voter2).castVote(pauseProposalId, 1); // Vote "For"

      // Wait for voting period to end
      await time.advanceBlockTo((await ethers.provider.getBlockNumber()) + VOTING_PERIOD + 1);

      // Queue the pause proposal
      await governor.queue(
        [await obligationRegistry.getAddress()],
        [0],
        [pauseCalldata],
        ethers.keccak256(ethers.toUtf8Bytes("Pause ObligationRegistry"))
      );

      // Wait for timelock delay
      await time.increase(MIN_DELAY + 1);
      await time.advanceBlock();

      // Execute the pause proposal
      await governor.execute(
        [await obligationRegistry.getAddress()],
        [0],
        [pauseCalldata],
        ethers.keccak256(ethers.toUtf8Bytes("Pause ObligationRegistry"))
      );
      
      expect(await obligationRegistry.paused()).to.be.true;

      const calldata = obligationRegistry.interface.encodeFunctionData("unpause");
      
      const tx = await governor.connect(voter1).propose(
        [await obligationRegistry.getAddress()],
        [0],
        [calldata],
        "Unpause ObligationRegistry"
      );
      
      const receipt = await tx.wait();
      const proposalId = extractProposalIdFromReceipt(receipt, governor.interface);

      // Wait for voting delay to pass
      await time.advanceBlockTo((await ethers.provider.getBlockNumber()) + VOTING_DELAY + 1);

      // Vote
      await governor.connect(voter1).castVote(proposalId, 1);
      await governor.connect(voter2).castVote(proposalId, 1);

      await time.advanceBlockTo((await ethers.provider.getBlockNumber()) + VOTING_PERIOD + 1);

      // Queue
      await governor.queue(
        [await obligationRegistry.getAddress()],
        [0],
        [calldata],
        ethers.keccak256(ethers.toUtf8Bytes("Unpause ObligationRegistry"))
      );

      await time.increase(MIN_DELAY + 1);
      await time.advanceBlock();
      await time.advanceBlock(); // extra block for safety

      await expect(
        governor.execute(
          [await obligationRegistry.getAddress()],
          [0],
          [calldata],
          ethers.keccak256(ethers.toUtf8Bytes("Unpause ObligationRegistry"))
        )
      ).to.emit(obligationRegistry, "Unpaused");

      expect(await obligationRegistry.paused()).to.be.false;
    });
  });

  describe("Parameter Changes via Governance", function () {
    it("should change voting parameters via governance", async function () {
      const newVotingPeriod = 10;
      const calldata = governor.interface.encodeFunctionData("setVotingPeriod", [newVotingPeriod]);
      
      const tx = await governor.connect(voter1).propose(
        [await governor.getAddress()],
        [0],
        [calldata],
        "Update voting period"
      );
      
      const receipt = await tx.wait();
      const proposalId = extractProposalIdFromReceipt(receipt, governor.interface);

      // Wait for voting delay to pass
      await time.advanceBlockTo((await ethers.provider.getBlockNumber()) + VOTING_DELAY + 1);

      // Vote
      await governor.connect(voter1).castVote(proposalId, 1);
      await governor.connect(voter2).castVote(proposalId, 1);

      await time.advanceBlockTo((await ethers.provider.getBlockNumber()) + VOTING_PERIOD + 1);

      // Queue
      await governor.queue(
        [await governor.getAddress()],
        [0],
        [calldata],
        ethers.keccak256(ethers.toUtf8Bytes("Update voting period"))
      );

      await time.increase(MIN_DELAY + 1);
      await time.advanceBlock();
      await time.advanceBlock(); // extra block for safety

      await governor.execute(
        [await governor.getAddress()],
        [0],
        [calldata],
        ethers.keccak256(ethers.toUtf8Bytes("Update voting period"))
      );

      expect(await governor.votingPeriod()).to.equal(newVotingPeriod);
    });
  });

  describe("Emergency Governance Path", function () {
    it("should handle emergency proposal execution", async function () {
      // Test emergency proposal (if implemented)
      // This would require emergency role setup
      
      const calldata = obligationRegistry.interface.encodeFunctionData("updateMinimumOracleScore", [90]);
      
      const tx = await governor.connect(voter1).propose(
        [await obligationRegistry.getAddress()],
        [0],
        [calldata],
        "Emergency parameter change"
      );
      
      const receipt = await tx.wait();
      const proposalId = extractProposalIdFromReceipt(receipt, governor.interface);

      // Wait for voting delay to pass
      await time.advanceBlockTo((await ethers.provider.getBlockNumber()) + VOTING_DELAY + 1);

      // Vote
      await governor.connect(voter1).castVote(proposalId, 1);
      await governor.connect(voter2).castVote(proposalId, 1);

      await time.advanceBlockTo((await ethers.provider.getBlockNumber()) + VOTING_PERIOD + 1);

      // Queue
      await governor.queue(
        [await obligationRegistry.getAddress()],
        [0],
        [calldata],
        ethers.keccak256(ethers.toUtf8Bytes("Emergency parameter change"))
      );

      await time.increase(MIN_DELAY + 1);
      await time.advanceBlock();
      await time.advanceBlock(); // extra block for safety

      await governor.execute(
        [await obligationRegistry.getAddress()],
        [0],
        [calldata],
        ethers.keccak256(ethers.toUtf8Bytes("Emergency parameter change"))
      );

      expect(await obligationRegistry.minimumOracleScore()).to.equal(90);
    });
  });
});