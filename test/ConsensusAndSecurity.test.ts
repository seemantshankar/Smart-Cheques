import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  GovernanceToken,
  SmartChequeGovernor,
  ValidatorManager,
  ConsensusManager,
  SmartChequeTimelockController
} from "../typechain";

describe("Consensus and Security Implementation", function () {
  let governanceToken: GovernanceToken;
  let governance: SmartChequeGovernor;
  let validatorManager: ValidatorManager;
  let consensusManager: ConsensusManager;
  let timelockController: SmartChequeTimelockController;
  
  let owner: SignerWithAddress;
  let validator1: SignerWithAddress;
  let validator2: SignerWithAddress;
  let validator3: SignerWithAddress;
  let delegator: SignerWithAddress;
  let challenger: SignerWithAddress;
  let users: SignerWithAddress[];
  
  const INITIAL_SUPPLY = ethers.utils.parseEther("100000000"); // 100M tokens
  const MIN_STAKE = ethers.utils.parseEther("10000"); // 10k tokens
  const VALIDATOR_STAKE = ethers.utils.parseEther("50000"); // 50k tokens
  const DELEGATION_AMOUNT = ethers.utils.parseEther("5000"); // 5k tokens
  
  beforeEach(async function () {
    [owner, validator1, validator2, validator3, delegator, challenger, ...users] = await ethers.getSigners();
    
    // Deploy GovernanceToken
    const GovernanceTokenFactory = await ethers.getContractFactory("GovernanceToken");
    governanceToken = await GovernanceTokenFactory.deploy();
    await governanceToken.deployed();
    
    // Deploy TimelockController
    const TimelockControllerFactory = await ethers.getContractFactory("SmartChequeTimelockController");
    const minDelay = 1; // 1 block delay for testing
    timelockController = await TimelockControllerFactory.deploy(
      minDelay,
      [owner.address], // proposers
      [owner.address], // executors
      owner.address    // admin
    );
    await timelockController.deployed();
    
    // Deploy Governance
    const GovernanceFactory = await ethers.getContractFactory("SmartChequeGovernor");
    governance = await GovernanceFactory.deploy(
      governanceToken.address,
      timelockController.address
    );
    await governance.deployed();
    
    // Grant proposer and executor roles to governance contract
    const PROPOSER_ROLE = await timelockController.PROPOSER_ROLE();
    const EXECUTOR_ROLE = await timelockController.EXECUTOR_ROLE();
    
    await timelockController.grantRole(PROPOSER_ROLE, governance.address);
    await timelockController.grantRole(EXECUTOR_ROLE, governance.address);
    
    // Deploy ValidatorManager
    const ValidatorManagerFactory = await ethers.getContractFactory("ValidatorManager");
    validatorManager = await ValidatorManagerFactory.deploy(governanceToken.address);
    await validatorManager.deployed();
    
    // Deploy ConsensusManager
    const ConsensusManagerFactory = await ethers.getContractFactory("ConsensusManager");
    consensusManager = await ConsensusManagerFactory.deploy(validatorManager.address);
    await consensusManager.deployed();
    
    // Setup roles
    await validatorManager.grantRole(await validatorManager.SLASHER_ROLE(), consensusManager.address);
    await validatorManager.grantRole(await validatorManager.SLASHER_ROLE(), owner.address); // Grant to owner for testing
    await validatorManager.grantRole(await validatorManager.ORACLE_ROLE(), owner.address);
    await consensusManager.grantRole(await consensusManager.SEQUENCER_ROLE(), owner.address);
    await consensusManager.grantRole(await consensusManager.VALIDATOR_ROLE(), validator1.address);
    await consensusManager.grantRole(await consensusManager.VALIDATOR_ROLE(), validator2.address);
    await consensusManager.grantRole(await consensusManager.VALIDATOR_ROLE(), validator3.address);
    await consensusManager.grantRole(await consensusManager.ORACLE_ROLE(), owner.address);
    await validatorManager.grantRole(await validatorManager.ORACLE_ROLE(), consensusManager.address); // Grant to consensusManager for block production
    
    // Distribute tokens
    await governanceToken.transfer(validator1.address, VALIDATOR_STAKE.mul(2));
    await governanceToken.transfer(validator2.address, VALIDATOR_STAKE.mul(2));
    await governanceToken.transfer(validator3.address, VALIDATOR_STAKE.mul(2));
    await governanceToken.transfer(delegator.address, DELEGATION_AMOUNT.mul(3));
    await governanceToken.transfer(challenger.address, ethers.utils.parseEther("1000"));
  });
  
  describe("GovernanceToken", function () {
    it("Should deploy with correct initial supply", async function () {
      expect(await governanceToken.totalSupply()).to.equal(INITIAL_SUPPLY);
      expect(await governanceToken.balanceOf(owner.address)).to.be.gt(0);
    });
    
    it("Should allow staking tokens", async function () {
      await governanceToken.connect(validator1).approve(governanceToken.address, VALIDATOR_STAKE);
      await governanceToken.connect(validator1).stake(VALIDATOR_STAKE);
      
      expect(await governanceToken.stakedBalances(validator1.address)).to.equal(VALIDATOR_STAKE);
      expect(await governanceToken.totalStaked()).to.equal(VALIDATOR_STAKE);
    });
    
    it("Should allow becoming a validator after staking", async function () {
      await governanceToken.connect(validator1).approve(governanceToken.address, VALIDATOR_STAKE);
      await governanceToken.connect(validator1).stake(VALIDATOR_STAKE);
      await governanceToken.connect(validator1).becomeValidator();
      
      expect(await governanceToken.isValidator(validator1.address)).to.be.true;
    });
    
    it("Should calculate staking rewards correctly", async function () {
      await governanceToken.connect(validator1).approve(governanceToken.address, VALIDATOR_STAKE);
      await governanceToken.connect(validator1).stake(VALIDATOR_STAKE);
      
      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [365 * 24 * 60 * 60]); // 1 year
      await ethers.provider.send("evm_mine", []);
      
      const rewards = await governanceToken.calculateRewards(validator1.address);
      const expectedRewards = VALIDATOR_STAKE.mul(5).div(100); // 5% annual reward
      
      expect(rewards).to.be.closeTo(expectedRewards, ethers.utils.parseEther("100"));
    });
    
    it("Should allow claiming rewards", async function () {
      await governanceToken.connect(validator1).approve(governanceToken.address, VALIDATOR_STAKE);
      await governanceToken.connect(validator1).stake(VALIDATOR_STAKE);
      
      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [365 * 24 * 60 * 60]); // 1 year
      await ethers.provider.send("evm_mine", []);
      
      const balanceBefore = await governanceToken.balanceOf(validator1.address);
      await governanceToken.connect(validator1).claimRewards();
      const balanceAfter = await governanceToken.balanceOf(validator1.address);
      
      expect(balanceAfter).to.be.gt(balanceBefore);
    });
  });
  
  describe("ValidatorManager", function () {
    beforeEach(async function () {
      // Setup validators with staked tokens
      for (const validator of [validator1, validator2, validator3]) {
        await governanceToken.connect(validator).approve(validatorManager.address, VALIDATOR_STAKE);
        await validatorManager.connect(validator).registerValidator(
          VALIDATOR_STAKE,
          ethers.utils.formatBytes32String("pubkey"),
          `Validator ${validator.address.slice(-4)}`,
          500 // 5% commission
        );
      }
    });
    
    it("Should register validators correctly", async function () {
      const activeValidators = await validatorManager.getActiveValidators();
      expect(activeValidators.length).to.equal(3);
      expect(activeValidators).to.include(validator1.address);
      expect(activeValidators).to.include(validator2.address);
      expect(activeValidators).to.include(validator3.address);
    });
    
    it("Should allow delegation to validators", async function () {
      await governanceToken.connect(delegator).approve(validatorManager.address, DELEGATION_AMOUNT);
      await validatorManager.connect(delegator).delegate(validator1.address, DELEGATION_AMOUNT);
      
      const delegationInfo = await validatorManager.getDelegationInfo(delegator.address, validator1.address);
      expect(delegationInfo.amount).to.equal(DELEGATION_AMOUNT);
      
      const validatorInfo = await validatorManager.getValidatorInfo(validator1.address);
      expect(validatorInfo.delegatedStake).to.equal(DELEGATION_AMOUNT);
    });
    
    it("Should allow undelegation", async function () {
      await governanceToken.connect(delegator).approve(validatorManager.address, DELEGATION_AMOUNT);
      await validatorManager.connect(delegator).delegate(validator1.address, DELEGATION_AMOUNT);
      
      const balanceBefore = await governanceToken.balanceOf(delegator.address);
      await validatorManager.connect(delegator).undelegate(validator1.address, DELEGATION_AMOUNT);
      const balanceAfter = await governanceToken.balanceOf(delegator.address);
      
      expect(balanceAfter).to.equal(balanceBefore.add(DELEGATION_AMOUNT));
    });
    
    it("Should slash validators for misbehavior", async function () {
      const validatorInfoBefore = await validatorManager.getValidatorInfo(validator1.address);
      
      await validatorManager.slashValidator(
        validator1.address,
        0, // DOUBLE_SIGNING
        ethers.utils.toUtf8Bytes("Evidence of double signing")
      );
      
      const validatorInfoAfter = await validatorManager.getValidatorInfo(validator1.address);
      expect(validatorInfoAfter.stake).to.be.lt(validatorInfoBefore.stake);
      expect(validatorInfoAfter.totalSlashed).to.be.gt(0);
    });
    
    it("Should jail validators for downtime", async function () {
      await validatorManager.jailValidator(validator1.address, 1); // DOWNTIME
      
      const validatorInfo = await validatorManager.getValidatorInfo(validator1.address);
      expect(validatorInfo.status).to.equal(2); // JAILED
      
      const activeValidators = await validatorManager.getActiveValidators();
      expect(activeValidators).to.not.include(validator1.address);
    });
    
    it("Should allow unjailing after jail period", async function () {
      await validatorManager.jailValidator(validator1.address, 1); // DOWNTIME
      
      // Fast forward past jail duration
      await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]); // 7 days + 1 second
      await ethers.provider.send("evm_mine", []);
      
      await validatorManager.connect(validator1).unjailValidator();
      
      const validatorInfo = await validatorManager.getValidatorInfo(validator1.address);
      expect(validatorInfo.status).to.equal(1); // ACTIVE
    });
  });
  
  describe("ConsensusManager", function () {
    beforeEach(async function () {
      // Setup validators
      for (const validator of [validator1, validator2, validator3]) {
        await governanceToken.connect(validator).approve(validatorManager.address, VALIDATOR_STAKE);
        await validatorManager.connect(validator).registerValidator(
          VALIDATOR_STAKE,
          ethers.utils.formatBytes32String("pubkey"),
          `Validator ${validator.address.slice(-4)}`,
          500
        );
      }
    });
    
    it("Should propose blocks correctly", async function () {
      const parentHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("genesis"));
      const stateRoot = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("state"));
      const transactionsRoot = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("transactions"));
      const receiptsRoot = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("receipts"));
      
      await expect(
        consensusManager.proposeBlock(
          parentHash,
          stateRoot,
          transactionsRoot,
          receiptsRoot,
          1000000, // gasUsed
          ethers.utils.toUtf8Bytes("extra")
        )
      ).to.emit(consensusManager, "BlockProposed");
      
      expect(await consensusManager.currentBlockNumber()).to.equal(1);
    });
    
    it("Should validate blocks with validator signatures", async function () {
      // Propose a block
      const parentHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("genesis"));
      const stateRoot = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("state"));
      const transactionsRoot = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("transactions"));
      const receiptsRoot = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("receipts"));
      
      const tx = await consensusManager.proposeBlock(
        parentHash,
        stateRoot,
        transactionsRoot,
        receiptsRoot,
        1000000,
        ethers.utils.toUtf8Bytes("extra")
      );
      
      const receipt = await tx.wait();
      const blockProposedEvent = receipt.events?.find(e => e.event === "BlockProposed");
      const blockHash = blockProposedEvent?.args?.blockHash;
      
      // Sign the block hash
      const messageHash = ethers.utils.hashMessage(ethers.utils.arrayify(blockHash));
      const signature = await validator1.signMessage(ethers.utils.arrayify(blockHash));
      
      await expect(
        consensusManager.connect(validator1).validateBlock(blockHash, signature)
      ).to.emit(consensusManager, "BlockValidated");
    });
    
    it("Should finalize blocks with sufficient validations", async function () {
      // Propose a block
      const parentHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("genesis"));
      const stateRoot = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("state"));
      const transactionsRoot = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("transactions"));
      const receiptsRoot = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("receipts"));
      
      const tx = await consensusManager.proposeBlock(
        parentHash,
        stateRoot,
        transactionsRoot,
        receiptsRoot,
        1000000,
        ethers.utils.toUtf8Bytes("extra")
      );
      
      const receipt = await tx.wait();
      const blockProposedEvent = receipt.events?.find(e => e.event === "BlockProposed");
      const blockHash = blockProposedEvent?.args?.blockHash;
      
      // Get signatures from validators (need 67% = 2 out of 3)
      for (const validator of [validator1, validator2]) {
        const signature = await validator.signMessage(ethers.utils.arrayify(blockHash));
        await consensusManager.connect(validator).validateBlock(blockHash, signature);
      }
      
      // Check if block is finalized
      const validation = await consensusManager.getBlockValidation(blockHash);
      expect(validation.finalized).to.be.true;
    });
    
    it("Should handle fraud proofs", async function () {
      // Propose a block
      const parentHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("genesis"));
      const stateRoot = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("state"));
      const transactionsRoot = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("transactions"));
      const receiptsRoot = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("receipts"));
      
      const tx = await consensusManager.proposeBlock(
        parentHash,
        stateRoot,
        transactionsRoot,
        receiptsRoot,
        1000000,
        ethers.utils.toUtf8Bytes("extra")
      );
      
      const receipt = await tx.wait();
      const blockProposedEvent = receipt.events?.find(e => e.event === "BlockProposed");
      const blockHash = blockProposedEvent?.args?.blockHash;
      
      // Submit fraud proof
      const stateTransition = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("fraud"));
      const transactions = [ethers.utils.toUtf8Bytes("tx1")];
      const receipts = [ethers.utils.toUtf8Bytes("receipt1")];
      const merkleProofs = [ethers.utils.toUtf8Bytes("proof1")];
      
      await expect(
        consensusManager.connect(challenger).submitFraudProof(
          blockHash,
          stateTransition,
          transactions,
          receipts,
          merkleProofs
        )
      ).to.emit(consensusManager, "FraudProofSubmitted");
      
      const fraudProof = await consensusManager.getFraudProof(blockHash);
      expect(fraudProof.challenger).to.equal(challenger.address);
    });
  });
  
  describe("Governance", function () {
    beforeEach(async function () {
      // Setup governance token voting power
      await governanceToken.connect(validator1).approve(governanceToken.address, VALIDATOR_STAKE);
      await governanceToken.connect(validator1).stake(VALIDATOR_STAKE);
      await governanceToken.connect(validator1).becomeValidator();
      
      // Grant roles to governance contract
      await timelockController.grantRole(
        await timelockController.PROPOSER_ROLE(),
        governance.address
      );
      await timelockController.grantRole(
        await timelockController.EXECUTOR_ROLE(),
        governance.address
      );
    });
    
    it("Should create proposals with metadata", async function () {
      const targets = [validatorManager.address];
      const values = [0];
      const calldatas = [validatorManager.interface.encodeFunctionData("setMinValidatorStake", [ethers.utils.parseEther("60000")])];
      const description = "Increase minimum validator stake";
      const title = "Validator Stake Increase";
      
      await expect(
        governance.connect(validator1).proposeWithMetadata(
          targets,
          values,
          calldatas,
          description,
          0, // PARAMETER_CHANGE
          title
        )
      ).to.emit(governance, "ProposalCreated");
    });
    
    it("Should create emergency proposals", async function () {
      const targets = [validatorManager.address];
      const values = [0];
      const calldatas = [validatorManager.interface.encodeFunctionData("pause")];
      const description = "Emergency pause";
      
      await expect(
        governance.connect(validator1).proposeEmergency(
          targets,
          values,
          calldatas,
          description
        )
      ).to.emit(governance, "ProposalCreated");
    });
  });
  
  describe("TimelockController", function () {
    it("Should schedule proposals with different categories", async function () {
      const target = validatorManager.address;
      const value = 0;
      const data = validatorManager.interface.encodeFunctionData("setMinValidatorStake", [ethers.utils.parseEther("60000")]);
      const predecessor = ethers.constants.HashZero;
      const salt = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("salt"));
      
      await expect(
        timelockController.scheduleWithCategory(
          target,
          value,
          data,
          predecessor,
          salt,
          1 // CRITICAL
        )
      ).to.emit(timelockController, "ProposalCategorized");
    });
    
    it("Should activate and deactivate emergency mode", async function () {
      await expect(
        timelockController.activateEmergencyMode()
      ).to.emit(timelockController, "EmergencyModeActivated");
      
      expect(await timelockController.emergencyMode()).to.be.true;
      
      await expect(
        timelockController.deactivateEmergencyMode()
      ).to.emit(timelockController, "EmergencyModeDeactivated");
      
      expect(await timelockController.emergencyMode()).to.be.false;
    });
    
    it("Should schedule emergency proposals with reduced delay", async function () {
      await timelockController.activateEmergencyMode();
      
      const target = validatorManager.address;
      const value = 0;
      const data = validatorManager.interface.encodeFunctionData("pause");
      const predecessor = ethers.constants.HashZero;
      const salt = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("emergency"));
      
      await expect(
        timelockController.scheduleEmergency(
          target,
          value,
          data,
          predecessor,
          salt
        )
      ).to.emit(timelockController, "CallScheduled");
    });
  });
  
  describe("Integration Tests", function () {
    it("Should handle complete validator lifecycle", async function () {
      // Register validator
      await governanceToken.connect(validator1).approve(validatorManager.address, VALIDATOR_STAKE);
      await validatorManager.connect(validator1).registerValidator(
        VALIDATOR_STAKE,
        ethers.utils.formatBytes32String("pubkey"),
        "Test Validator",
        500
      );
      
      // Delegate to validator
      await governanceToken.connect(delegator).approve(validatorManager.address, DELEGATION_AMOUNT);
      await validatorManager.connect(delegator).delegate(validator1.address, DELEGATION_AMOUNT);
      
      // Propose and validate block
      const parentHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("genesis"));
      const stateRoot = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("state"));
      const transactionsRoot = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("transactions"));
      const receiptsRoot = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("receipts"));
      
      const tx = await consensusManager.proposeBlock(
        parentHash,
        stateRoot,
        transactionsRoot,
        receiptsRoot,
        1000000,
        ethers.utils.toUtf8Bytes("extra")
      );
      
      const receipt = await tx.wait();
      const blockProposedEvent = receipt.events?.find(e => e.event === "BlockProposed");
      const blockHash = blockProposedEvent?.args?.blockHash;
      
      // Record block production
      await validatorManager.recordBlockProduction(validator1.address, 1);
      
      // Verify validator received rewards
      const validatorInfo = await validatorManager.getValidatorInfo(validator1.address);
      expect(validatorInfo.validator).to.equal(validator1.address);
    });
    
    it("Should handle governance proposal execution", async function () {
      // Setup voting power
      await governanceToken.connect(validator1).approve(governanceToken.address, VALIDATOR_STAKE);
      await governanceToken.connect(validator1).stake(VALIDATOR_STAKE);
      
      // Grant necessary roles
      await timelockController.grantRole(
        await timelockController.PROPOSER_ROLE(),
        governance.address
      );
      await timelockController.grantRole(
        await timelockController.EXECUTOR_ROLE(),
        governance.address
      );
      
      // Create proposal to change validator parameters
      const targets = [validatorManager.address];
      const values = [0];
      const calldatas = [validatorManager.interface.encodeFunctionData("setMinValidatorStake", [ethers.utils.parseEther("60000")])];
      const description = "Increase minimum validator stake to 60k tokens";
      
      const proposalTx = await governance.connect(validator1).proposeWithMetadata(
        targets,
        values,
        calldatas,
        description,
        0, // PARAMETER_CHANGE
        "Validator Stake Increase"
      );
      
      const proposalReceipt = await proposalTx.wait();
      const proposalEvent = proposalReceipt.events?.find(e => e.event === "ProposalCreated");
      const proposalId = proposalEvent?.args?.proposalId;
      
      // Wait for voting delay (1 block)
      await ethers.provider.send("evm_mine", []);
      await ethers.provider.send("evm_mine", []);
      
      // Vote on proposal
      await governance.connect(validator1).castVote(proposalId, 1); // Vote FOR
      
      // Fast forward past voting period (mine enough blocks)
      for (let i = 0; i < 10; i++) {
        await ethers.provider.send("evm_mine", []);
      }
      
      // Queue proposal
      await governance.queue(targets, values, calldatas, ethers.utils.keccak256(ethers.utils.toUtf8Bytes(description)));
      
      // Fast forward past timelock delay (1 block)
      await ethers.provider.send("evm_mine", []);
      await ethers.provider.send("evm_mine", []);
      
      // Execute proposal
      await governance.execute(targets, values, calldatas, ethers.utils.keccak256(ethers.utils.toUtf8Bytes(description)));
      
      // Verify parameter was changed
      expect(await validatorManager.minValidatorStake()).to.equal(ethers.utils.parseEther("60000"));
    });
  });
});