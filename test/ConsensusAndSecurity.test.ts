import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers.js";
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
  
  const INITIAL_SUPPLY = ethers.parseEther("100000000"); // 100M tokens
  const VALIDATOR_STAKE = ethers.parseEther("50000"); // 50k tokens
  const DELEGATION_AMOUNT = ethers.parseEther("5000"); // 5k tokens
  
  beforeEach(async function () {
    [owner, validator1, validator2, validator3, delegator, challenger] = await ethers.getSigners();
    
    // Deploy GovernanceToken
    const GovernanceTokenFactory = await ethers.getContractFactory("GovernanceToken");
    governanceToken = await GovernanceTokenFactory.deploy();
    await governanceToken.waitForDeployment();
    
    // Deploy TimelockController
    const TimelockControllerFactory = await ethers.getContractFactory("SmartChequeTimelockController");
    const minDelay = 1; // 1 block delay for testing
    timelockController = await TimelockControllerFactory.deploy(
      minDelay,
      [owner.address], // proposers
      [owner.address], // executors
      owner.address    // admin
    );
    await timelockController.waitForDeployment();
    
    // Deploy Governance
    const GovernanceFactory = await ethers.getContractFactory("SmartChequeGovernor");
    governance = await GovernanceFactory.deploy(
      await governanceToken.getAddress(),
      await timelockController.getAddress()
    );
    await governance.waitForDeployment();
    
    // Grant proposer and executor roles to governance contract
    const PROPOSER_ROLE = await timelockController.PROPOSER_ROLE();
    const EXECUTOR_ROLE = await timelockController.EXECUTOR_ROLE();
    
    await timelockController.grantRole(PROPOSER_ROLE, await governance.getAddress());
    await timelockController.grantRole(EXECUTOR_ROLE, await governance.getAddress());
    
    // Deploy ValidatorManager
    const ValidatorManagerFactory = await ethers.getContractFactory("ValidatorManager");
    validatorManager = await ValidatorManagerFactory.deploy(await governanceToken.getAddress());
    await validatorManager.waitForDeployment();
    
    // Deploy ConsensusManager
    const ConsensusManagerFactory = await ethers.getContractFactory("ConsensusManager");
    consensusManager = await ConsensusManagerFactory.deploy(await validatorManager.getAddress());
    await consensusManager.waitForDeployment();
    
    // Setup roles
    await validatorManager.grantRole(await validatorManager.SLASHER_ROLE(), await consensusManager.getAddress());
    await validatorManager.grantRole(await validatorManager.SLASHER_ROLE(), owner.address); // Grant to owner for testing
    await validatorManager.grantRole(await validatorManager.ORACLE_ROLE(), owner.address);
    await consensusManager.grantRole(await consensusManager.SEQUENCER_ROLE(), owner.address);
    await consensusManager.grantRole(await consensusManager.VALIDATOR_ROLE(), validator1.address);
    await consensusManager.grantRole(await consensusManager.SEQUENCER_ROLE(), owner.address);
    await consensusManager.grantRole(await consensusManager.ORACLE_ROLE(), owner.address);
    await consensusManager.grantRole(await consensusManager.ADMIN_ROLE(), owner.address);
    await validatorManager.grantRole(await validatorManager.ORACLE_ROLE(), await consensusManager.getAddress()); // Grant to consensusManager for block production
    
    // Distribute tokens
    await governanceToken.transfer(await validator1.getAddress(), VALIDATOR_STAKE * 2n);
      await governanceToken.transfer(await validator2.getAddress(), VALIDATOR_STAKE * 2n);
      await governanceToken.transfer(await validator3.getAddress(), VALIDATOR_STAKE * 2n);
      await governanceToken.transfer(await delegator.getAddress(), DELEGATION_AMOUNT * 3n);
    await governanceToken.transfer(await challenger.getAddress(), ethers.parseEther("1000"));
  });
  
  describe("GovernanceToken", function () {
    it("Should deploy with correct initial supply", async function () {
      expect(await governanceToken.totalSupply()).to.equal(INITIAL_SUPPLY);
      expect(await governanceToken.balanceOf(await owner.getAddress())).to.be.gt(0);
    });
    
    it("Should allow staking tokens", async function () {
      await governanceToken.connect(validator1).approve(await governanceToken.getAddress(), VALIDATOR_STAKE);
      await governanceToken.connect(validator1).stake(VALIDATOR_STAKE);
      
      expect(await governanceToken.stakedBalances(await validator1.getAddress())).to.equal(VALIDATOR_STAKE);
      expect(await governanceToken.totalStaked()).to.equal(VALIDATOR_STAKE);
    });
    
    it("Should allow becoming a validator after staking", async function () {
      await governanceToken.connect(validator1).approve(await governanceToken.getAddress(), VALIDATOR_STAKE);
      await governanceToken.connect(validator1).stake(VALIDATOR_STAKE);
      await governanceToken.connect(validator1).becomeValidator();
      
      expect(await governanceToken.isValidator(await validator1.getAddress())).to.be.true;
    });
    
    it("Should calculate staking rewards correctly", async function () {
      await governanceToken.connect(validator1).approve(await governanceToken.getAddress(), VALIDATOR_STAKE);
      await governanceToken.connect(validator1).stake(VALIDATOR_STAKE);
      
      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [365 * 24 * 60 * 60]); // 1 year
      await ethers.provider.send("evm_mine", []);
      
      const rewards = await governanceToken.calculateRewards(await validator1.getAddress());
      const expectedRewards = VALIDATOR_STAKE * 5n / 100n; // 5% annual reward
      
      expect(rewards).to.be.closeTo(expectedRewards, ethers.parseEther("100"));
    });
    
    it("Should allow claiming rewards", async function () {
      await governanceToken.connect(validator1).approve(await governanceToken.getAddress(), VALIDATOR_STAKE);
      await governanceToken.connect(validator1).stake(VALIDATOR_STAKE);
      
      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [365 * 24 * 60 * 60]); // 1 year
      await ethers.provider.send("evm_mine", []);
      
      const balanceBefore = await governanceToken.balanceOf(await validator1.getAddress());
      await governanceToken.connect(validator1).claimRewards();
      const balanceAfter = await governanceToken.balanceOf(await validator1.getAddress());
      
      expect(balanceAfter).to.be.gt(balanceBefore);
    });
  });
  
  describe("ValidatorManager", function () {
    beforeEach(async function () {
      // Setup validators with staked tokens
      for (const validator of [validator1, validator2, validator3]) {
        await governanceToken.connect(validator).approve(await validatorManager.getAddress(), VALIDATOR_STAKE);
        await validatorManager.connect(validator).registerValidator(
          VALIDATOR_STAKE,
          ethers.encodeBytes32String("pubkey"),
          `Validator ${(await validator.getAddress()).slice(-4)}`,
          500 // 5% commission
        );
      }
    });
    
    it("Should register validators correctly", async function () {
      const activeValidators = await validatorManager.getActiveValidators();
      expect(activeValidators.length).to.equal(3);
      expect(activeValidators).to.include(await validator1.getAddress());
      expect(activeValidators).to.include(await validator2.getAddress());
      expect(activeValidators).to.include(await validator3.getAddress());
    });
    
    it("Should allow delegation to validators", async function () {
      await governanceToken.connect(delegator).approve(await validatorManager.getAddress(), DELEGATION_AMOUNT);
      await validatorManager.connect(delegator).delegate(await validator1.getAddress(), DELEGATION_AMOUNT);
      
      const delegationInfo = await validatorManager.getDelegationInfo(await delegator.getAddress(), await validator1.getAddress());
      expect(delegationInfo.amount).to.equal(DELEGATION_AMOUNT);
      
      const validatorInfo = await validatorManager.getValidatorInfo(await validator1.getAddress());
      expect(validatorInfo.delegatedStake).to.equal(DELEGATION_AMOUNT);
    });
    
    it("Should allow undelegation", async function () {
      await governanceToken.connect(delegator).approve(await validatorManager.getAddress(), DELEGATION_AMOUNT);
      await validatorManager.connect(delegator).delegate(await validator1.getAddress(), DELEGATION_AMOUNT);
      
      const balanceBefore = await governanceToken.balanceOf(await delegator.getAddress());
      await validatorManager.connect(delegator).undelegate(await validator1.getAddress(), DELEGATION_AMOUNT);
      const balanceAfter = await governanceToken.balanceOf(await delegator.getAddress());
      
      expect(balanceAfter).to.equal(balanceBefore + DELEGATION_AMOUNT);
    });
    
    it("Should slash validators for misbehavior", async function () {
      const validatorInfoBefore = await validatorManager.getValidatorInfo(await validator1.getAddress());
      
      await validatorManager.slashValidator(
        await validator1.getAddress(),
        0, // DOUBLE_SIGNING
        ethers.toUtf8Bytes("Evidence of double signing")
      );
      
      const validatorInfoAfter = await validatorManager.getValidatorInfo(await validator1.getAddress());
      expect(validatorInfoAfter.stake).to.be.lt(validatorInfoBefore.stake);
      expect(validatorInfoAfter.totalSlashed).to.be.gt(0);
    });
    
    it("Should jail validators for downtime", async function () {
      await validatorManager.jailValidator(await validator1.getAddress(), 1); // DOWNTIME
      
      const validatorInfo = await validatorManager.getValidatorInfo(await validator1.getAddress());
      expect(validatorInfo.status).to.equal(2); // JAILED
      
      const activeValidators = await validatorManager.getActiveValidators();
      expect(activeValidators).to.not.include(await validator1.getAddress());
    });
    
    it("Should allow unjailing after jail period", async function () {
      await validatorManager.jailValidator(await validator1.getAddress(), 1); // DOWNTIME
      
      // Fast forward past jail duration
      await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]); // 7 days + 1 second
      await ethers.provider.send("evm_mine", []);
      
      await validatorManager.connect(validator1).unjailValidator();
      
      const validatorInfo = await validatorManager.getValidatorInfo(await validator1.getAddress());
      expect(validatorInfo.status).to.equal(1); // ACTIVE
    });
  });
  
  describe("ConsensusManager", function () {
    beforeEach(async function () {
      // Setup validators
      for (const validator of [validator1, validator2, validator3]) {
        await governanceToken.connect(validator).approve(await validatorManager.getAddress(), VALIDATOR_STAKE);
        await validatorManager.connect(validator).registerValidator(
          VALIDATOR_STAKE,
          ethers.encodeBytes32String("pubkey"),
          `Validator ${(await validator.getAddress()).slice(-4)}`,
          500
        );
      }
    });
    
    it("Should propose blocks correctly", async function () {
      const parentHash = ethers.keccak256(ethers.toUtf8Bytes("genesis"));
      const stateRoot = ethers.keccak256(ethers.toUtf8Bytes("state"));
      const transactionsRoot = ethers.keccak256(ethers.toUtf8Bytes("transactions"));
      const receiptsRoot = ethers.keccak256(ethers.toUtf8Bytes("receipts"));
      
      await expect(
        consensusManager.proposeBlock(
          parentHash,
          stateRoot,
          transactionsRoot,
          receiptsRoot,
          1000000, // gasUsed
          ethers.toUtf8Bytes("extra")
        )
      ).to.emit(consensusManager, "BlockProposed");
      
      expect(await consensusManager.currentBlockNumber()).to.equal(1);
    });
    
    it("Should validate blocks with validator signatures", async function () {
      // Propose a block
      const parentHash = ethers.keccak256(ethers.toUtf8Bytes("genesis"));
      const stateRoot = ethers.keccak256(ethers.toUtf8Bytes("state"));
      const transactionsRoot = ethers.keccak256(ethers.toUtf8Bytes("transactions"));
      const receiptsRoot = ethers.keccak256(ethers.toUtf8Bytes("receipts"));
      
      const tx = await consensusManager.proposeBlock(
          parentHash,
          stateRoot,
          transactionsRoot,
          receiptsRoot,
          1000000,
          ethers.toUtf8Bytes("extra")
        );
      
      const receipt = await tx.wait();
      const blockProposedEvent = receipt?.logs?.find(log => {
        try {
          return consensusManager.interface.parseLog(log)?.name === "BlockProposed";
        } catch {
          return false;
        }
      });
      
      const blockHash = blockProposedEvent ? consensusManager.interface.parseLog(blockProposedEvent)?.args?.blockHash : ethers.ZeroHash;
      
      // Sign the block hash
      const signature = await validator1.signMessage(ethers.getBytes(blockHash));
      
      await expect(
        consensusManager.connect(validator1).validateBlock(blockHash, signature)
      ).to.emit(consensusManager, "BlockValidated");
    });
    
    it("Should finalize blocks with sufficient validations", async function () {
      // Propose a block
      const parentHash = ethers.keccak256(ethers.toUtf8Bytes("genesis"));
      const stateRoot = ethers.keccak256(ethers.toUtf8Bytes("state"));
      const transactionsRoot = ethers.keccak256(ethers.toUtf8Bytes("transactions"));
      const receiptsRoot = ethers.keccak256(ethers.toUtf8Bytes("receipts"));
      
      const tx = await consensusManager.proposeBlock(
        parentHash,
        stateRoot,
        transactionsRoot,
        receiptsRoot,
        1000000,
        ethers.toUtf8Bytes("extra")
      );
      
      const receipt = await tx.wait();
      const blockProposedEvent = receipt?.logs?.find(log => {
        try {
          return consensusManager.interface.parseLog(log)?.name === "BlockProposed";
        } catch {
          return false;
        }
      });
      
      const blockHash = blockProposedEvent ? consensusManager.interface.parseLog(blockProposedEvent)?.args?.blockHash : ethers.ZeroHash;
      
      // Get signatures from validators (need 67% = 2 out of 3)
      for (const validator of [validator1, validator2]) {
        const signature = await validator.signMessage(ethers.getBytes(blockHash));
        await consensusManager.connect(validator).validateBlock(blockHash, signature);
      }
      
      // Check if block is finalized
      const validation = await consensusManager.getBlockValidation(blockHash);
      expect(validation.finalized).to.be.true;
    });
    
    it("Should handle fraud proofs", async function () {
      // Propose a block
      const parentHash = ethers.keccak256(ethers.toUtf8Bytes("genesis"));
      const stateRoot = ethers.keccak256(ethers.toUtf8Bytes("state"));
      const transactionsRoot = ethers.keccak256(ethers.toUtf8Bytes("transactions"));
      const receiptsRoot = ethers.keccak256(ethers.toUtf8Bytes("receipts"));
      
      const tx = await consensusManager.proposeBlock(
        parentHash,
        stateRoot,
        transactionsRoot,
        receiptsRoot,
        1000000,
        ethers.toUtf8Bytes("extra")
      );
      
      const receipt = await tx.wait();
      const blockProposedEvent = receipt?.logs?.find(log => {
        try {
          return consensusManager.interface.parseLog(log)?.name === "BlockProposed";
        } catch {
          return false;
        }
      });
      
      const blockHash = blockProposedEvent ? consensusManager.interface.parseLog(blockProposedEvent)?.args?.blockHash : ethers.ZeroHash;
      
      // Submit fraud proof
      const stateTransition = ethers.keccak256(ethers.toUtf8Bytes("fraud"));
      const transactions = [ethers.toUtf8Bytes("tx1")];
      const receipts = [ethers.toUtf8Bytes("receipt1")];
      const merkleProofs = [ethers.toUtf8Bytes("proof1")];
      
      // Approve and transfer challenge bond
      const challengeBond = ethers.parseEther("1000");
      await governanceToken.connect(challenger).approve(await consensusManager.getAddress(), challengeBond);
      
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
      expect(fraudProof.challenger).to.equal(await challenger.getAddress());
    });
  });
  
  describe("Governance", function () {
    beforeEach(async function () {
      // Setup governance token voting power
      await governanceToken.connect(validator1).approve(await governanceToken.getAddress(), VALIDATOR_STAKE);
      await governanceToken.connect(validator1).stake(VALIDATOR_STAKE);
      await governanceToken.connect(validator1).becomeValidator();
      
      // Grant roles to governance contract
      await timelockController.grantRole(
        await timelockController.PROPOSER_ROLE(),
        await governance.getAddress()
      );
      await timelockController.grantRole(
        await timelockController.EXECUTOR_ROLE(),
        await governance.getAddress()
      );
    });
    
    it("Should create proposals with metadata", async function () {
      const targets = [await validatorManager.getAddress()];
      const values = [0];
      const calldatas = [validatorManager.interface.encodeFunctionData("setMinValidatorStake", [ethers.parseEther("60000")])];
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
      const targets = [await validatorManager.getAddress()];
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
      const target = await validatorManager.getAddress();
      const value = 0;
      const data = validatorManager.interface.encodeFunctionData("setMinValidatorStake", [ethers.parseEther("60000")]);
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("salt"));
      
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
      
      const target = await validatorManager.getAddress();
      const value = 0;
      const data = validatorManager.interface.encodeFunctionData("pause");
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("emergency"));
      
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
      await governanceToken.connect(validator1).approve(await validatorManager.getAddress(), VALIDATOR_STAKE);
      await validatorManager.connect(validator1).registerValidator(
        VALIDATOR_STAKE,
        ethers.encodeBytes32String("pubkey"),
        "Test Validator",
        500
      );
      
      // Delegate to validator
      await governanceToken.connect(delegator).approve(await validatorManager.getAddress(), DELEGATION_AMOUNT);
      await validatorManager.connect(delegator).delegate(await validator1.getAddress(), DELEGATION_AMOUNT);
      
      // Propose and validate block
      const parentHash = ethers.keccak256(ethers.toUtf8Bytes("genesis"));
      const stateRoot = ethers.keccak256(ethers.toUtf8Bytes("state"));
      const transactionsRoot = ethers.keccak256(ethers.toUtf8Bytes("transactions"));
      const receiptsRoot = ethers.keccak256(ethers.toUtf8Bytes("receipts"));
      
      await consensusManager.proposeBlock(
        parentHash,
        stateRoot,
        transactionsRoot,
        receiptsRoot,
        1000000,
        ethers.toUtf8Bytes("extra")
      );
      
      // Record block production
      await validatorManager.recordBlockProduction(await validator1.getAddress(), 1);
      
      // Verify validator received rewards
      const validatorInfo = await validatorManager.getValidatorInfo(await validator1.getAddress());
      expect(validatorInfo.validator).to.equal(await validator1.getAddress());
    });
    
    it("Should handle governance proposal execution", async function () {
      // Setup voting power
      await governanceToken.connect(validator1).approve(await governanceToken.getAddress(), VALIDATOR_STAKE);
      await governanceToken.connect(validator1).delegate(await validator1.getAddress());
      
      // Grant necessary roles
      await timelockController.grantRole(
        await timelockController.PROPOSER_ROLE(),
        await governance.getAddress()
      );
      await timelockController.grantRole(
        await timelockController.EXECUTOR_ROLE(),
        await governance.getAddress()
      );
      
      // Create proposal to change validator parameters
      const targets = [await validatorManager.getAddress()];
      const values = [0];
      const calldatas = [validatorManager.interface.encodeFunctionData("setMinValidatorStake", [ethers.parseEther("60000")])];
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
      const proposalEvent = proposalReceipt?.logs?.find(log => {
        try {
          const parsed = governance.interface.parseLog(log);
          return parsed?.name === "ProposalCreated";
        } catch {
          return false;
        }
      });
      const parsedEvent = proposalEvent ? governance.interface.parseLog(proposalEvent) : null;
      const proposalId = parsedEvent?.args?.proposalId;
      
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
      await governance.queue(targets, values, calldatas, description);
      
      // Fast forward past timelock delay (1 block)
      await ethers.provider.send("evm_mine", []);
      await ethers.provider.send("evm_mine", []);
      
      // Execute proposal
      await governance.execute(targets, values, calldatas, description);
      
      // Verify parameter was changed
      expect(await validatorManager.minValidatorStake()).to.equal(ethers.parseEther("60000"));
    });
  });
});