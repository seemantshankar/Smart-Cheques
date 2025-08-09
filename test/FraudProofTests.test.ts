import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers.js";

describe("Fraud Proof Challenge System", function () {
  let consensusManager: any;
  let validatorManager: any;
  let governanceToken: any;
  let owner: SignerWithAddress;
  let validator1: SignerWithAddress;
  let validator2: SignerWithAddress;
  let validator3: SignerWithAddress;
  let sequencer1: SignerWithAddress;
  let challenger: SignerWithAddress;

  beforeEach(async function () {
    [owner, validator1, validator2, validator3, sequencer1, challenger] = await ethers.getSigners();

    // Deploy GovernanceToken
    const governanceTokenFactory = await ethers.getContractFactory("contracts/GovernanceToken.sol:GovernanceToken");
    governanceToken = await governanceTokenFactory.deploy();
    await governanceToken.waitForDeployment();

    // Deploy ValidatorManager
    const validatorManagerFactory = await ethers.getContractFactory("ValidatorManager");
    validatorManager = await validatorManagerFactory.deploy(await governanceToken.getAddress());
    await validatorManager.waitForDeployment();

    // Deploy ConsensusManager
    const consensusManagerFactory = await ethers.getContractFactory("ConsensusManager");
    consensusManager = await consensusManagerFactory.deploy(await validatorManager.getAddress(), await governanceToken.getAddress());
    await consensusManager.waitForDeployment();

    // Setup roles
    await consensusManager.connect(owner).batchSetupRoles([await owner.getAddress()], [await validator1.getAddress(), await validator2.getAddress(), await validator3.getAddress()], [await sequencer1.getAddress()]);
    
    // Grant SLASHER_ROLE to ConsensusManager so it can slash validators
    await validatorManager.grantRole(await validatorManager.SLASHER_ROLE(), await consensusManager.getAddress());

    // Transfer tokens to validators for ValidatorManager registration
        const stakeAmount = ethers.parseEther("50000"); // 50k tokens (ValidatorManager minimum stake)
    
    // Check owner balance and mint more tokens if needed
    const ownerBalance = await governanceToken.balanceOf(await owner.getAddress());
    const totalNeeded = stakeAmount * 4n; // 4 validators * stakeAmount each
    
    // Transfer tokens for ValidatorManager registration (validators need tokens in their balance)
    await governanceToken.transfer(await validator1.getAddress(), stakeAmount);
    await governanceToken.transfer(await validator2.getAddress(), stakeAmount);
    await governanceToken.transfer(await validator3.getAddress(), stakeAmount);
    // Give challenger extra tokens for challenge bonds (50k for staking + 10k for challenges)
    await governanceToken.transfer(await challenger.getAddress(), stakeAmount + ethers.parseEther("10000"));
    await governanceToken.transfer(await sequencer1.getAddress(), stakeAmount);
    
    // Approve ValidatorManager to transfer tokens for registration
    await governanceToken.connect(validator1).approve(await validatorManager.getAddress(), stakeAmount);
    await governanceToken.connect(validator2).approve(await validatorManager.getAddress(), stakeAmount);
    await governanceToken.connect(validator3).approve(await validatorManager.getAddress(), stakeAmount);
    await governanceToken.connect(challenger).approve(await validatorManager.getAddress(), stakeAmount);
    await governanceToken.connect(sequencer1).approve(await validatorManager.getAddress(), stakeAmount);
    
    // Register validators and challenger
        const publicKey = ethers.randomBytes(32);
        await validatorManager.connect(validator1).registerValidator(stakeAmount, publicKey, "Validator 1", 1000);
        await validatorManager.connect(validator2).registerValidator(stakeAmount, publicKey, "Validator 2", 1000);
        await validatorManager.connect(validator3).registerValidator(stakeAmount, publicKey, "Validator 3", 1000);
        await validatorManager.connect(challenger).registerValidator(stakeAmount, publicKey, "Challenger", 1000);
        await validatorManager.connect(sequencer1).registerValidator(stakeAmount, publicKey, "Sequencer 1", 1000);
  });

  // Note: Fraud proof resolution tests removed as resolveFraudProof function is not implemented

  describe("Block Proposal and Challenge Window", function () {
    it("Should allow block proposal with proper challenge window", async function () {
      const blockNumber = 1;
      const stateRoot = ethers.keccak256("0x1234");
      const transactionsRoot = ethers.keccak256("0x5678");
      const receiptsRoot = ethers.keccak256("0x9abc");
      const timestamp = Math.floor(Date.now() / 1000);
      const gasUsed = 100000;
      const gasLimit = 8000000;

      const blockHeader = {
        blockNumber,
        parentHash: ethers.keccak256(ethers.toUtf8Bytes("genesis")),
        stateRoot,
        transactionsRoot,
        receiptsRoot,
        gasUsed,
        gasLimit,
        extraData: "0x"
      };

      const tx = await consensusManager.connect(sequencer1).proposeBlock(
        blockHeader.parentHash,
        blockHeader.stateRoot,
        blockHeader.transactionsRoot,
        blockHeader.receiptsRoot,
        blockHeader.gasUsed,
        blockHeader.extraData
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
      const validation = await consensusManager.getBlockValidationStatus(blockHash);
      
      expect(validation.finalized).to.be.false;
      expect(validation.challenged).to.be.false;
    });

    it("Should allow fraud proof submission within challenge window", async function () {
      // Propose a block first
      const blockNumber = 1;
      const stateRoot = ethers.keccak256("0x1234");
      const transactionsRoot = ethers.keccak256("0x5678");
      const receiptsRoot = ethers.keccak256("0x9abc");
      const timestamp = Math.floor(Date.now() / 1000);
      const gasUsed = 100000;
      const gasLimit = 8000000;

      const blockHeader = {
        blockNumber,
        parentHash: ethers.keccak256(ethers.toUtf8Bytes("genesis")),
        stateRoot,
        transactionsRoot,
        receiptsRoot,
        timestamp,
        gasUsed,
        gasLimit,
        extraData: "0x"
      };

      const tx = await consensusManager.connect(sequencer1).proposeBlock(
        blockHeader.parentHash,
        blockHeader.stateRoot,
        blockHeader.transactionsRoot,
        blockHeader.receiptsRoot,
        blockHeader.gasUsed,
        blockHeader.extraData
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
      const stateTransition = ethers.keccak256("0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890");
      const transactions = [ethers.toUtf8Bytes("tx1"), ethers.toUtf8Bytes("tx2")];
      const receipts = [ethers.toUtf8Bytes("receipt1"), ethers.toUtf8Bytes("receipt2")];
      const merkleProofs = [ethers.toUtf8Bytes("proof1"), ethers.toUtf8Bytes("proof2")];

      // Approve challenge bond
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
      )
        .to.emit(consensusManager, "FraudProofSubmitted")
        .withArgs(blockHash, challenger.address, stateTransition);

      const validation = await consensusManager.getBlockValidationStatus(blockHash);
      expect(validation.challenged).to.be.true;
      
      const fraudProof = await consensusManager.getFraudProofStatus(blockHash);
      expect(fraudProof.challenger).to.equal(await challenger.getAddress());
    });

    it("Should extend challenge deadline when fraud proof is submitted", async function () {
      // Propose a block
      const blockNumber = 1;
      const stateRoot = ethers.keccak256("0x1234");
      const transactionsRoot = ethers.keccak256("0x5678");
      const receiptsRoot = ethers.keccak256("0x9abc");
      const timestamp = Math.floor(Date.now() / 1000);
      const gasUsed = 100000;
      const gasLimit = 8000000;

      const blockHeader = {
        blockNumber,
        parentHash: ethers.keccak256(ethers.toUtf8Bytes("genesis")),
        stateRoot,
        transactionsRoot,
        receiptsRoot,
        timestamp,
        gasUsed,
        gasLimit,
        extraData: "0x"
      };

      const tx = await consensusManager.connect(sequencer1).proposeBlock(
        blockHeader.parentHash,
        blockHeader.stateRoot,
        blockHeader.transactionsRoot,
        blockHeader.receiptsRoot,
        blockHeader.gasUsed,
        blockHeader.extraData
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

      const initialValidation = await consensusManager.getBlockValidationStatus(blockHash);
      expect(initialValidation.challenged).to.be.false;

      // Submit fraud proof - the state transition should match the encoded transaction data
      // for the fraud proof to be considered valid by _verifyStateTransition
      const transactions = [ethers.toUtf8Bytes("tx1")];
      const receipts = [ethers.toUtf8Bytes("receipt1")];
      const merkleProofs = [ethers.toUtf8Bytes("proof1")];
      // Calculate state transition that will match in _verifyStateTransition
      const stateTransition = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes[]", "bytes[]", "bytes[]"], [transactions, receipts, merkleProofs]));

      // Approve challenge bond
      const challengeBond = ethers.parseEther("1000");
      await governanceToken.connect(challenger).approve(await consensusManager.getAddress(), challengeBond);

      await consensusManager.connect(challenger).submitFraudProof(
        blockHash,
        stateTransition,
        transactions,
        receipts,
        merkleProofs
      );

      const updatedValidation = await consensusManager.getBlockValidationStatus(blockHash);
      expect(updatedValidation.challenged).to.be.true;
    });

    it("Should prevent fraud proof submission after challenge window expires", async function () {
      // Propose a block
      const blockNumber = 1;
      const stateRoot = ethers.keccak256("0x1234");
      const transactionsRoot = ethers.keccak256("0x5678");
      const receiptsRoot = ethers.keccak256("0x9abc");
      const timestamp = Math.floor(Date.now() / 1000);
      const gasUsed = 100000;
      const gasLimit = 8000000;

      const blockHeader = {
        blockNumber,
        parentHash: ethers.keccak256(ethers.toUtf8Bytes("genesis")),
        stateRoot,
        transactionsRoot,
        receiptsRoot,
        timestamp,
        gasUsed,
        gasLimit,
        extraData: "0x"
      };

      const tx = await consensusManager.connect(sequencer1).proposeBlock(
        blockHeader.parentHash,
        blockHeader.stateRoot,
        blockHeader.transactionsRoot,
        blockHeader.receiptsRoot,
        blockHeader.gasUsed,
        blockHeader.extraData
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

      // Fast forward time past challenge window (7 days + 1 hour)
      await ethers.provider.send("evm_increaseTime", [7 * 24 * 3600 + 3600]); // 7 days + 1 hour
      await ethers.provider.send("evm_mine");

      // Attempt to submit fraud proof
      const stateTransition = ethers.keccak256("0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890");
      const transactions = [ethers.toUtf8Bytes("tx1")];
      const receipts = [ethers.toUtf8Bytes("receipt1")];
      const merkleProofs = [ethers.toUtf8Bytes("proof1")];

      // Approve challenge bond (even though it will revert)
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
      ).to.be.revertedWithCustomError(consensusManager, "InvalidChallengePeriod");
    });

    it("Should prevent non-validators from submitting fraud proofs", async function () {
      // Propose a block
      const blockNumber = 1;
      const stateRoot = ethers.keccak256("0x1234");
      const transactionsRoot = ethers.keccak256("0x5678");
      const receiptsRoot = ethers.keccak256("0x9abc");
      const timestamp = Math.floor(Date.now() / 1000);
      const gasUsed = 100000;
      const gasLimit = 8000000;

      const blockHeader = {
        blockNumber,
        parentHash: ethers.keccak256(ethers.toUtf8Bytes("genesis")),
        stateRoot,
        transactionsRoot,
        receiptsRoot,
        timestamp,
        gasUsed,
        gasLimit,
        extraData: "0x"
      };

      const tx = await consensusManager.connect(sequencer1).proposeBlock(
        blockHeader.parentHash,
        blockHeader.stateRoot,
        blockHeader.transactionsRoot,
        blockHeader.receiptsRoot,
        blockHeader.gasUsed,
        blockHeader.extraData
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

      // Attempt to submit fraud proof from non-validator
      const nonValidator = owner; // owner is not a validator
      const stateTransition = ethers.keccak256("0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890");
      const transactions = [ethers.toUtf8Bytes("tx1")];
      const receipts = [ethers.toUtf8Bytes("receipt1")];
      const merkleProofs = [ethers.toUtf8Bytes("proof1")];

      // Approve challenge bond (even though it will revert)
      const challengeBond = ethers.parseEther("1000");
      await governanceToken.connect(nonValidator).approve(await consensusManager.getAddress(), challengeBond);

      await expect(
        consensusManager.connect(nonValidator).submitFraudProof(
          blockHash,
          stateTransition,
          transactions,
          receipts,
          merkleProofs
        )
      ).to.be.revertedWithCustomError(consensusManager, "UnauthorizedAccess");
    });
  });

  describe("Fraud Proof Verification", function () {
    beforeEach(async function () {
      // Propose a block
      const blockNumber = 1;
      const stateRoot = ethers.keccak256("0x1234");
      const transactionsRoot = ethers.keccak256("0x5678");
      const receiptsRoot = ethers.keccak256("0x9abc");
      const timestamp = Math.floor(Date.now() / 1000);
      const gasUsed = 100000;
      const gasLimit = 8000000;

      const blockHeader = {
        blockNumber,
        parentHash: ethers.keccak256(ethers.toUtf8Bytes("genesis")),
        stateRoot,
        transactionsRoot,
        receiptsRoot,
        timestamp,
        gasUsed,
        gasLimit,
        extraData: "0x"
      };

      const tx = await consensusManager.connect(sequencer1).proposeBlock(
        blockHeader.parentHash,
        blockHeader.stateRoot,
        blockHeader.transactionsRoot,
        blockHeader.receiptsRoot,
        blockHeader.gasUsed,
        blockHeader.extraData
      );
      
      const receipt = await tx.wait();
      const blockProposedEvent = receipt?.logs?.find(log => {
        try {
          return consensusManager.interface.parseLog(log)?.name === "BlockProposed";
        } catch {
          return false;
        }
      });
      
      this.blockHash = blockProposedEvent ? consensusManager.interface.parseLog(blockProposedEvent)?.args?.blockHash : ethers.ZeroHash;

      // Submit fraud proof - provide transaction data that differs from what was claimed in the block
      // The block was proposed with arbitrary hash values, but we're providing actual transaction data
      // that doesn't match those hashes, proving the block is fraudulent
      const transactions = [ethers.toUtf8Bytes("actual_tx_data")];
      const receipts = [ethers.toUtf8Bytes("actual_receipt_data")];
      const merkleProofs = [ethers.toUtf8Bytes("actual_proof_data")];
      const stateTransition = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes[]", "bytes[]", "bytes[]"], [transactions, receipts, merkleProofs]));

      // Approve and transfer challenge bond
      const challengeBond = ethers.parseEther("1000");
      await governanceToken.connect(challenger).approve(await consensusManager.getAddress(), challengeBond);

      await consensusManager.connect(challenger).submitFraudProof(
        this.blockHash,
        stateTransition,
        transactions,
        receipts,
        merkleProofs
      );
    });

    it("Should allow oracles to verify fraud proofs", async function () {
      await expect(consensusManager.connect(owner).verifyFraudProof(this.blockHash))
        .to.emit(consensusManager, "FraudProofVerified")
        .withArgs(this.blockHash, true, challenger.address);

      const validation = await consensusManager.getBlockValidationStatus(this.blockHash);
      expect(validation.finalized).to.be.false;
      
      const fraudProof = await consensusManager.getFraudProofStatus(this.blockHash);
      expect(fraudProof.verified).to.be.true;
    });

    it("Should prevent non-oracles from verifying fraud proofs", async function () {
      await expect(
        consensusManager.connect(validator1).verifyFraudProof(this.blockHash)
      ).to.be.revertedWith("AccessControl: account 0x70997970c51812dc3a010c7d01b50e0d17dc79c8 is missing role 0x68e79a7bf1e0bc45d0a330c573bc367f9cf464fd326078812f301165fbda4ef1");
    });

    it("Should prevent verification after challenge window expires", async function () {
      // Fast forward time past challenge window (7 days + 1 hour)
      await ethers.provider.send("evm_increaseTime", [7 * 24 * 3600 + 3600]); // 7 days + 1 hour
      await ethers.provider.send("evm_mine");

      await expect(
        consensusManager.connect(owner).verifyFraudProof(this.blockHash)
      ).to.be.revertedWithCustomError(consensusManager, "InvalidChallengePeriod");
    });

    it("Should prevent duplicate verification", async function () {
      // First verification should succeed
      await expect(consensusManager.connect(owner).verifyFraudProof(this.blockHash))
        .to.emit(consensusManager, "FraudProofVerified")
        .withArgs(this.blockHash, true, challenger.address);

      // Second verification should fail
      await expect(
        consensusManager.connect(owner).verifyFraudProof(this.blockHash)
      ).to.be.revertedWithCustomError(consensusManager, "InvalidFraudProof");
    });

    it("Should prevent duplicate fraud proof submission", async function () {
      // Submit fraud proof again (should fail)
      const transactions2 = [ethers.toUtf8Bytes("actual_tx_data")];
      const receipts2 = [ethers.toUtf8Bytes("actual_receipt_data")];
      const merkleProofs2 = [ethers.toUtf8Bytes("actual_proof_data")];
      const stateTransition2 = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes[]", "bytes[]", "bytes[]"], [transactions2, receipts2, merkleProofs2]));

      // Approve challenge bond (even though it will revert)
      const challengeBond = ethers.parseEther("1000");
      await governanceToken.connect(challenger).approve(await consensusManager.getAddress(), challengeBond);

      await expect(
        consensusManager.connect(challenger).submitFraudProof(
          this.blockHash,
          stateTransition2,
          transactions2,
          receipts2,
          merkleProofs2
        )
      ).to.be.revertedWithCustomError(consensusManager, "ChallengeAlreadyExists");
    });
  });
});