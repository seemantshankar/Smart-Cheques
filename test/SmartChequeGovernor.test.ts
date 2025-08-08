import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { keccak256, toUtf8Bytes } from "ethers";

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
  const PROPOSAL_THRESHOLD = 0; // 0 tokens
  const QUORUM_PERCENTAGE = 4; // 4%

  beforeEach(async function () {
    [deployer, proposer, executor, voter1, voter2] = await ethers.getSigners();

    // Deploy GovernanceToken
    const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
    governanceToken = await GovernanceToken.deploy();

    // Deploy Timelock
    const SmartChequeTimelockController = await ethers.getContractFactory("SmartChequeTimelockController");
    timelock = await SmartChequeTimelockController.deploy(
      MIN_DELAY,
      [proposer.address],
      [executor.address]
    );

    // Deploy Governor
    const SmartChequeGovernor = await ethers.getContractFactory("SmartChequeGovernor");
    governor = await SmartChequeGovernor.deploy(
      await governanceToken.getAddress(),
      await timelock.getAddress(),
      VOTING_DELAY,
      VOTING_PERIOD,
      PROPOSAL_THRESHOLD,
      QUORUM_PERCENTAGE
    );

    // Deploy core contracts
    const SmartChequeEscrow = await ethers.getContractFactory("SmartChequeEscrow");
    escrow = await SmartChequeEscrow.deploy();

    const SmartChequeFactory = await ethers.getContractFactory("SmartChequeFactory");
    factory = await SmartChequeFactory.deploy(await escrow.getAddress());

    const ObligationRegistry = await ethers.getContractFactory("ObligationRegistry");
    obligationRegistry = await ObligationRegistry.deploy();

    // Initialize contracts
    await escrow.initialize();
    await factory.initialize();
    await obligationRegistry.initialize();

    // Setup roles
    await escrow.grantRole(await escrow.DEFAULT_ADMIN_ROLE(), await timelock.getAddress());
    await factory.grantRole(await factory.DEFAULT_ADMIN_ROLE(), await timelock.getAddress());
    await obligationRegistry.grantRole(await obligationRegistry.ADMIN_ROLE(), await timelock.getAddress());

    // Remove deployer admin roles
    await escrow.renounceRole(await escrow.DEFAULT_ADMIN_ROLE(), deployer.address);
    await factory.renounceRole(await factory.DEFAULT_ADMIN_ROLE(), deployer.address);
    await obligationRegistry.renounceRole(await obligationRegistry.ADMIN_ROLE(), deployer.address);

    // Setup governor as proposer
    await timelock.grantRole(await timelock.PROPOSER_ROLE(), await governor.getAddress());

    // Distribute governance tokens
    await governanceToken.mint(voter1.address, ethers.parseEther("1000"));
    await governanceToken.mint(voter2.address, ethers.parseEther("1000"));
    await governanceToken.mint(deployer.address, ethers.parseEther("1000"));

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
        [obligationRegistry.target],
        [0],
        [calldata],
        "Update minimum oracle score to 80"
      );

      const receipt = await tx.wait();
      const events = receipt.events?.filter(e => e.event === "ProposalCreated");
      expect(events).to.have.length(1);

      const proposalId = events![0].args?.proposalId;
      const proposal = await governor.proposals(proposalId);
      expect(proposal.proposer).to.equal(voter1.address);
    });

    it("should prevent proposal without voting power", async function () {
      const [nonVoter] = await ethers.getSigners();
      
      const calldata = obligationRegistry.interface.encodeFunctionData("updateMinimumOracleScore", [80]);

      await expect(
        governor.connect(nonVoter).propose(
          [obligationRegistry.address],
          [0],
          [calldata],
          "Test proposal"
        )
      ).to.be.revertedWith("Governor: proposer votes below proposal threshold");
    });
  });

  describe("Voting and Execution", function () {
    let proposalId: string;

    beforeEach(async function () {
      const calldata = obligationRegistry.interface.encodeFunctionData("updateMinimumOracleScore", [80]);
      
      const tx = await governor.connect(voter1).propose(
        [obligationRegistry.address],
        [0],
        [calldata],
        "Update minimum oracle score to 80"
      );
      
      const receipt = await tx.wait();
      proposalId = receipt.events?.find(e => e.event === "ProposalCreated")?.args?.proposalId;
    });

    it("should allow voting on active proposal", async function () {
      await governor.connect(voter1).castVote(proposalId, 1); // For
      await governor.connect(voter2).castVote(proposalId, 1); // For

      const proposal = await governor.proposals(proposalId);
      expect(proposal.forVotes).to.equal(ethers.parseEther("2000"));
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
        keccak256(toUtf8Bytes("Update minimum oracle score to 80"))
      );

      // Wait for timelock delay
      await time.increase(MIN_DELAY + 1);

      // Execute
      await expect(
        governor.execute(
          [await obligationRegistry.getAddress()],
          [0],
          [obligationRegistry.interface.encodeFunctionData("updateMinimumOracleScore", [80])],
          keccak256(toUtf8Bytes("Update minimum oracle score to 80"))
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
          [obligationRegistry.target],
          [0],
          [obligationRegistry.interface.encodeFunctionData("updateMinimumOracleScore", [80])],
          keccak256(toUtf8Bytes("Update minimum oracle score to 80"))
        )
      ).to.be.revertedWith("Governor: proposal not successful");
    });
  });

  describe("Contract Upgrades via Governance", function () {
    let proposalId: string;

    beforeEach(async function () {
      // Deploy new implementation
      const SmartChequeEscrowV2 = await ethers.getContractFactory("SmartChequeEscrow");
      const newImplementation = await SmartChequeEscrowV2.deploy();
      await newImplementation.waitForDeployment();

      const calldata = escrow.interface.encodeFunctionData("upgradeTo", [newImplementation.target]);
      
      const tx = await governor.connect(voter1).propose(
        [escrow.target],
        [0],
        [calldata],
        "Upgrade SmartChequeEscrow to V2"
      );
      
      const receipt = await tx.wait();
      proposalId = receipt.events?.find(e => e.event === "ProposalCreated")?.args?.proposalId;
    });

    it("should execute contract upgrade", async function () {
      // Vote
      await governor.connect(voter1).castVote(proposalId, 1);
      await governor.connect(voter2).castVote(proposalId, 1);

      await time.advanceBlockTo((await ethers.provider.getBlockNumber()) + VOTING_PERIOD + 1);

      // Queue
      await governor.queue(
        [escrow.target],
        [0],
        [escrow.interface.encodeFunctionData("upgradeTo", [newImplementation.target])],
        keccak256(toUtf8Bytes("Upgrade SmartChequeEscrow to V2"))
      );

      await time.increase(MIN_DELAY + 1);

      await expect(
        governor.execute(
          [escrow.target],
          [0],
          [escrow.interface.encodeFunctionData("upgradeTo", [newImplementation.target])],
          keccak256(toUtf8Bytes("Upgrade SmartChequeEscrow to V2"))
        )
      ).to.emit(escrow, "Upgraded").withArgs(newImplementation.target);
    });
  });

  describe("Emergency Pause/Unpause via Governance", function () {
    it("should pause contract via governance", async function () {
      const calldata = obligationRegistry.interface.encodeFunctionData("pause");
      
      const tx = await governor.connect(voter1).propose(
        [obligationRegistry.address],
        [0],
        [calldata],
        "Emergency pause ObligationRegistry"
      );
      
      const receipt = await tx.wait();
      const proposalId = receipt.events?.find(e => e.event === "ProposalCreated")?.args?.proposalId;

      // Vote
      await governor.connect(voter1).castVote(proposalId, 1);
      await governor.connect(voter2).castVote(proposalId, 1);

      await time.advanceBlockTo((await ethers.provider.getBlockNumber()) + VOTING_PERIOD + 1);

      // Queue
      await governor.queue(
        [obligationRegistry.address],
        [0],
        [calldata],
        keccak256(toUtf8Bytes("Emergency pause ObligationRegistry"))
      );

      await time.increase(MIN_DELAY + 1);

      await expect(
        governor.execute(
          [obligationRegistry.address],
          [0],
          [calldata],
          keccak256(toUtf8Bytes("Emergency pause ObligationRegistry"))
        )
      ).to.emit(obligationRegistry, "Paused");

      expect(await obligationRegistry.paused()).to.be.true;
    });

    it("should unpause contract via governance", async function () {
      // First pause via governance
      await obligationRegistry.connect(timelock.signer).pause();
      expect(await obligationRegistry.paused()).to.be.true;

      const calldata = obligationRegistry.interface.encodeFunctionData("unpause");
      
      const tx = await governor.connect(voter1).propose(
        [obligationRegistry.address],
        [0],
        [calldata],
        "Unpause ObligationRegistry"
      );
      
      const receipt = await tx.wait();
      const proposalId = receipt.events?.find(e => e.event === "ProposalCreated")?.args?.proposalId;

      // Vote
      await governor.connect(voter1).castVote(proposalId, 1);
      await governor.connect(voter2).castVote(proposalId, 1);

      await time.advanceBlockTo((await ethers.provider.getBlockNumber()) + VOTING_PERIOD + 1);

      // Queue
      await governor.queue(
        [obligationRegistry.address],
        [0],
        [calldata],
        keccak256(toUtf8Bytes("Unpause ObligationRegistry"))
      );

      await time.increase(MIN_DELAY + 1);

      await expect(
        governor.execute(
          [obligationRegistry.address],
          [0],
          [calldata],
          keccak256(toUtf8Bytes("Unpause ObligationRegistry"))
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
        [governor.target],
        [0],
        [calldata],
        "Update voting period"
      );
      
      const receipt = await tx.wait();
      const proposalId = receipt.events?.find(e => e.event === "ProposalCreated")?.args?.proposalId;

      // Vote
      await governor.connect(voter1).castVote(proposalId, 1);
      await governor.connect(voter2).castVote(proposalId, 1);

      await time.advanceBlockTo((await ethers.provider.getBlockNumber()) + VOTING_PERIOD + 1);

      // Queue
      await governor.queue(
        [governor.target],
        [0],
        [calldata],
        keccak256(toUtf8Bytes("Update voting period"))
      );

      await time.increase(MIN_DELAY + 1);

      await governor.execute(
        [governor.target],
        [0],
        [calldata],
        keccak256(toUtf8Bytes("Update voting period"))
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
        [obligationRegistry.address],
        [0],
        [calldata],
        "Emergency parameter change"
      );
      
      const receipt = await tx.wait();
      const proposalId = receipt.events?.find(e => e.event === "ProposalCreated")?.args?.proposalId;

      // Vote
      await governor.connect(voter1).castVote(proposalId, 1);
      await governor.connect(voter2).castVote(proposalId, 1);

      await time.advanceBlockTo((await ethers.provider.getBlockNumber()) + VOTING_PERIOD + 1);

      // Queue
      await governor.queue(
        [obligationRegistry.address],
        [0],
        [calldata],
        keccak256(toUtf8Bytes("Emergency parameter change"))
      );

      await time.increase(MIN_DELAY + 1);

      await governor.execute(
        [obligationRegistry.address],
        [0],
        [calldata],
        keccak256(toUtf8Bytes("Emergency parameter change"))
      );

      expect(await obligationRegistry.getMinimumOracleScore()).to.equal(90);
    });
  });
});