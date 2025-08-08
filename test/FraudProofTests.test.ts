import { expect } from "chai";
import { ethers } from "hardhat";
import { ConsensusManager, ValidatorManager, GovernanceToken } from "../typechain";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("Fraud Proof Challenge System", function () {
  let consensusManager: ConsensusManager;
  let validatorManager: ValidatorManager;
  let governanceToken: GovernanceToken;
  let owner: SignerWithAddress;
  let validator1: SignerWithAddress;
  let validator2: SignerWithAddress;
  let validator3: SignerWithAddress;
  let sequencer1: SignerWithAddress;
  let challenger: SignerWithAddress;

  beforeEach(async function () {
    [owner, validator1, validator2, validator3, sequencer1, challenger] = await ethers.getSigners();

    // Deploy GovernanceToken
    const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
    governanceToken = await GovernanceToken.deploy("Governance Token", "GOV", "1000000");
    await governanceToken.waitForDeployment();

    // Deploy ValidatorManager
    const ValidatorManager = await ethers.getContractFactory("ValidatorManager");
    validatorManager = await ValidatorManager.deploy(await governanceToken.getAddress());
    await validatorManager.waitForDeployment();

    // Deploy ConsensusManager
    const ConsensusManager = await ethers.getContractFactory("ConsensusManager");
    consensusManager = await ConsensusManager.deploy(await validatorManager.getAddress());
    await consensusManager.waitForDeployment();

    // Setup roles
    await consensusManager.connect(owner).batchSetupRoles([], [validator1.address, validator2.address, validator3.address], [sequencer1.address]);

    // Register validators with stake
    await governanceToken.connect(validator1).approve(await validatorManager.getAddress(), ethers.parseEther("1000"));
    await validatorManager.connect(validator1).registerValidator(ethers.parseEther("1000"));
    
    await governanceToken.connect(validator2).approve(await validatorManager.getAddress(), ethers.parseEther("1000"));
    await validatorManager.connect(validator2).registerValidator(ethers.parseEther("1000"));
    
    await governanceToken.connect(validator3).approve(await validatorManager.getAddress(), ethers.parseEther("1000"));
    await validatorManager.connect(validator3).registerValidator(ethers.parseEther("1000"));
    
    await governanceToken.connect(challenger).approve(await validatorManager.getAddress(), ethers.parseEther("1000"));
    await validatorManager.connect(challenger).registerValidator(ethers.parseEther("1000"));
  });

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
        parentHash: ethers.keccak256("0xparent"),
        stateRoot,
        transactionsRoot,
        receiptsRoot,
        gasUsed,
        gasLimit,
        extraData: "0x"
      };

      await expect(consensusManager.connect(sequencer1).proposeBlock(
        blockHeader.parentHash,
        blockHeader.stateRoot,
        blockHeader.transactionsRoot,
        blockHeader.receiptsRoot,
        blockHeader.gasUsed,
        blockHeader.extraData
      ))
        .to.emit(consensusManager, "BlockProposed")
        .withArgs(blockNumber, ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(uint256,bytes32,bytes32,bytes32,uint256,address,uint256,uint256,bytes32,uint256,bytes)"],
          [[
            blockNumber,
            blockHeader.parentHash,
            blockHeader.stateRoot,
            blockHeader.transactionsRoot,
            timestamp,
            await sequencer1.getAddress(),
            8000000,
            blockHeader.gasUsed,
            blockHeader.receiptsRoot,
            1,
            ethers.getBytes("0x")
          ]]
        )), blockHeader.parentHash);

      const blockHash = await consensusManager.getBlockHash(blockNumber);
      const validation = await consensusManager.blockValidations(blockHash);
      
      expect(validation.proposer).to.equal(sequencer1.address);
      expect(validation.challenged).to.be.false;
      expect(validation.challengeDeadline).to.be.gt(timestamp);
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
        stateRoot,
        transactionsRoot,
        receiptsRoot,
        timestamp,
        gasUsed,
        gasLimit,
        extraData: "0x"
      };

      await consensusManager.connect(sequencer1).proposeBlock(blockHeader);
      const blockHash = await consensusManager.getBlockHash(blockNumber);

      // Submit fraud proof
      const stateTransition = ethers.keccak256("0xfraud");
      const transactions = ["0xtx1", "0xtx2"];
      const receipts = ["0xreceipt1", "0xreceipt2"];
      const merkleProofs = ["0xproof1", "0xproof2"];

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

      const validation = await consensusManager.blockValidations(blockHash);
      expect(validation.challenged).to.be.true;
      expect(validation.challenger).to.equal(challenger.address);
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
        stateRoot,
        transactionsRoot,
        receiptsRoot,
        timestamp,
        gasUsed,
        gasLimit,
        extraData: "0x"
      };

      await consensusManager.connect(sequencer1).proposeBlock(blockHeader);
      const blockHash = await consensusManager.getBlockHash(blockNumber);

      const initialValidation = await consensusManager.blockValidations(blockHash);
      const initialDeadline = initialValidation.challengeDeadline;

      // Submit fraud proof
      const stateTransition = ethers.keccak256("0xfraud");
      const transactions = ["0xtx1"];
      const receipts = ["0xreceipt1"];
      const merkleProofs = ["0xproof1"];

      await consensusManager.connect(challenger).submitFraudProof(
        blockHash,
        stateTransition,
        transactions,
        receipts,
        merkleProofs
      );

      const updatedValidation = await consensusManager.blockValidations(blockHash);
      expect(updatedValidation.challengeDeadline).to.be.gt(initialDeadline);
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
        stateRoot,
        transactionsRoot,
        receiptsRoot,
        timestamp,
        gasUsed,
        gasLimit,
        extraData: "0x"
      };

      await consensusManager.connect(sequencer1).proposeBlock(blockHeader);
      const blockHash = await consensusManager.getBlockHash(blockNumber);

      // Fast forward time past challenge window
      await ethers.provider.send("evm_increaseTime", [3600]); // 1 hour
      await ethers.provider.send("evm_mine");

      // Attempt to submit fraud proof
      const stateTransition = ethers.keccak256("0xfraud");
      const transactions = ["0xtx1"];
      const receipts = ["0xreceipt1"];
      const merkleProofs = ["0xproof1"];

      await expect(
        consensusManager.connect(challenger).submitFraudProof(
          blockHash,
          stateTransition,
          transactions,
          receipts,
          merkleProofs
        )
      ).to.be.revertedWith("Challenge period expired");
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
        stateRoot,
        transactionsRoot,
        receiptsRoot,
        timestamp,
        gasUsed,
        gasLimit,
        extraData: "0x"
      };

      await consensusManager.connect(sequencer1).proposeBlock(blockHeader);
      const blockHash = await consensusManager.getBlockHash(blockNumber);

      // Attempt to submit fraud proof from non-validator
      const nonValidator = owner; // owner is not a validator
      const stateTransition = ethers.keccak256("0xfraud");
      const transactions = ["0xtx1"];
      const receipts = ["0xreceipt1"];
      const merkleProofs = ["0xproof1"];

      await expect(
        consensusManager.connect(nonValidator).submitFraudProof(
          blockHash,
          stateTransition,
          transactions,
          receipts,
          merkleProofs
        )
      ).to.be.revertedWith("Caller must be a validator");
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
        stateRoot,
        transactionsRoot,
        receiptsRoot,
        timestamp,
        gasUsed,
        gasLimit,
        extraData: "0x"
      };

      await consensusManager.connect(sequencer1).proposeBlock(blockHeader);
      this.blockHash = await consensusManager.getBlockHash(blockNumber);

      // Submit fraud proof
      const stateTransition = ethers.keccak256("0xfraud");
      const transactions = ["0xtx1"];
      const receipts = ["0xreceipt1"];
      const merkleProofs = ["0xproof1"];

      await consensusManager.connect(challenger).submitFraudProof(
        this.blockHash,
        stateTransition,
        transactions,
        receipts,
        merkleProofs
      );
    });

    it("Should allow validators to verify fraud proofs", async function () {
      await expect(consensusManager.connect(validator1).verifyFraudProof(this.blockHash))
        .to.emit(consensusManager, "FraudProofVerified")
        .withArgs(this.blockHash, validator1.address, true);

      const validation = await consensusManager.blockValidations(this.blockHash);
      expect(validation.valid).to.be.false;
      expect(validation.finalized).to.be.false;
    });

    it("Should prevent non-validators from verifying fraud proofs", async function () {
      await expect(
        consensusManager.connect(owner).verifyFraudProof(this.blockHash)
      ).to.be.revertedWith("AccessControlUnauthorizedAccount");
    });

    it("Should prevent verification after challenge window expires", async function () {
      // Fast forward time past challenge window
      await ethers.provider.send("evm_increaseTime", [3600]); // 1 hour
      await ethers.provider.send("evm_mine");

      await expect(
        consensusManager.connect(validator1).verifyFraudProof(this.blockHash)
      ).to.be.revertedWith("Challenge period expired");
    });

    it("Should prevent duplicate verification", async function () {
      await consensusManager.connect(validator1).verifyFraudProof(this.blockHash);

      await expect(
        consensusManager.connect(validator2).verifyFraudProof(this.blockHash)
      ).to.be.revertedWith("Already verified");
    });
  });
});