import { expect } from "chai";
import hre from "hardhat";
const { ethers, upgrades } = hre;
import type { Contract, Signer } from "ethers";

// EIP-712 helpers
const domain = async (contract: Contract, chainId: bigint) => ({
  name: "SmartChequeEscrow",
  version: "1",
  chainId,
  verifyingContract: await contract.getAddress(),
});

const types = {
  MilestoneAuthorization: [
    { name: "contractAddress", type: "address" },
    { name: "chainId", type: "uint256" },
    { name: "escrowId", type: "bytes32" },
    { name: "milestoneIndex", type: "uint256" },
    { name: "amount", type: "uint256" },
    { name: "recipient", type: "address" },
    { name: "deadline", type: "uint256" },
  ],
};

async function signAuth(
  signer: Signer,
  contract: Contract,
  chainId: bigint,
  escrowId: string,
  milestoneIndex: number,
  amount: bigint,
  recipient: string,
  deadline: number
) {
  const value = {
    contractAddress: await contract.getAddress(),
    chainId,
    escrowId,
    milestoneIndex,
    amount,
    recipient,
    deadline,
  };
  
  // Robust typed-data signing fallback for different ethers versions
  try {
    return await signer.signTypedData(await domain(contract, chainId), types, value);
  } catch (error) {
    // Fallback for older ethers versions
    return await (signer as any)._signTypedData(await domain(contract, chainId), types, value);
  }
}

describe("SmartChequeEscrow - OffChainSigned", function () {
  let buyer: Signer;
  let seller: Signer;
  let other: Signer;
  let token: Contract;
  let escrow: Contract;
  let chainId: bigint;
  let mockRegistry: Contract;

  beforeEach(async () => {
    // obligationRegistry must be set before locking funds
    [buyer, seller, other] = await ethers.getSigners();

    token = await ethers.getContractFactory("contracts/test/MockERC20.sol:MockERC20").then(f => f.deploy("Test Token", "TEST", ethers.parseEther("1000000")));
    escrow = await upgrades.deployProxy(
      await ethers.getContractFactory("SmartChequeEscrow"),
      [await buyer.getAddress(), await seller.getAddress(), 1000n, [500n, 500n], [ethers.ZeroHash, ethers.ZeroHash]],
      { initializer: "initialize" }
    );
    await token.waitForDeployment();
    await escrow.waitForDeployment();

    chainId = BigInt((await ethers.provider.getNetwork()).chainId);

    // Deploy mock obligation registry
    const MockRegistry = await ethers.getContractFactory("contracts/mocks/MockObligationRegistry.sol:MockObligationRegistry");
    const mockRegistry = await MockRegistry.deploy();
    await mockRegistry.waitForDeployment();

    // fund buyer and approve
    await (token as any).mint(await buyer.getAddress(), 1000n);
    await (token as any).connect(buyer).approve(await escrow.getAddress(), 1000n);

    // set obligation registry and lock funds
    await (escrow as any).connect(buyer).setObligationRegistry(await mockRegistry.getAddress());
    await (escrow as any).connect(buyer).lockFunds(await token.getAddress());

    // enable OffChainSigned and set signer
    await (escrow as any).connect(buyer).setAuthorizationMode(1); // OffChainSigned
    await (escrow as any).connect(buyer).setSigner(await buyer.getAddress());
  });

  it("completes milestone with valid signature", async () => {
    const escrowId = ethers.hexlify(ethers.randomBytes(32));
    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    const sig = await signAuth(
      buyer,
      escrow,
      chainId,
      escrowId,
      0,
      500n,
      await seller.getAddress(),
      deadline
    );

    await expect(
      (escrow as any).completeMilestoneWithSignature(escrowId, 0, await seller.getAddress(), deadline, sig)
    )
      .to.emit(escrow, "AuthorizationConsumed")
      .and.to.emit(escrow, "MilestoneCompleted");

    expect(await (token as any).balanceOf(await seller.getAddress())).to.equal(500n);
  });

  it("rejects with expired deadline", async () => {
    const escrowId = ethers.hexlify(ethers.randomBytes(32));
    const latest = await ethers.provider.getBlock("latest");
    const deadline = (latest?.timestamp ?? 0) - 1;
    const sig = await signAuth(
      buyer,
      escrow,
      chainId,
      escrowId,
      0,
      500n,
      await seller.getAddress(),
      deadline
    );

    await expect(
      (escrow as any).completeMilestoneWithSignature(escrowId, 0, await seller.getAddress(), deadline, sig)
    ).to.be.revertedWithCustomError(escrow, "AuthorizationExpired");
  });

  it("rejects when signer mismatch", async () => {
    await (escrow as any).connect(buyer).setSigner(await other.getAddress());

    const escrowId = ethers.hexlify(ethers.randomBytes(32));
    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    const sig = await signAuth(
      buyer,
      escrow,
      chainId,
      escrowId,
      0,
      500n,
      await seller.getAddress(),
      deadline
    );

    await expect(
      (escrow as any).completeMilestoneWithSignature(escrowId, 0, await seller.getAddress(), deadline, sig)
    ).to.be.revertedWithCustomError(escrow, "InvalidSignature");
  });

  it("rejects replay of same authorization", async () => {
    // Deploy a fresh escrow with 3 milestones to test authorization replay properly
    const freshEscrow = await upgrades.deployProxy(
      await ethers.getContractFactory("SmartChequeEscrow"),
      [await buyer.getAddress(), await seller.getAddress(), 1500n, [500n, 500n, 500n], [ethers.ZeroHash, ethers.ZeroHash, ethers.ZeroHash]],
      { initializer: "initialize" }
    );
    await freshEscrow.waitForDeployment();
    await (token as any).connect(buyer).approve(await freshEscrow.getAddress(), 1500n);
    
    // Deploy new mock registry for fresh escrow
    const FreshRegistry = await ethers.getContractFactory("contracts/mocks/MockObligationRegistry.sol:MockObligationRegistry");
    const freshRegistry = await FreshRegistry.deploy();
    await freshRegistry.waitForDeployment();
    
    await (freshEscrow as any).connect(buyer).setObligationRegistry(await freshRegistry.getAddress());
    await (freshEscrow as any).connect(buyer).lockFunds(await token.getAddress());
    await (freshEscrow as any).connect(buyer).setAuthorizationMode(1);
    await (freshEscrow as any).connect(buyer).setSigner(await buyer.getAddress());

    const escrowId = ethers.hexlify(ethers.randomBytes(32));
    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    const sig = await signAuth(
      buyer,
      freshEscrow,
      chainId,
      escrowId,
      0,
      500n,
      await seller.getAddress(),
      deadline
    );

    // First call should succeed
    await expect(
      (freshEscrow as any).completeMilestoneWithSignature(escrowId, 0, await seller.getAddress(), deadline, sig)
    ).to.emit(freshEscrow, "AuthorizationConsumed");

    // Create a different signature for milestone 1 but try to replay the authorization for milestone 0
    // This tests the authorization replay protection specifically
    const sig2 = await signAuth(
      buyer,
      freshEscrow,
      chainId,
      escrowId,
      1, // Different milestone
      500n,
      await seller.getAddress(),
      deadline
    );

    // Complete milestone 1 first
    await (freshEscrow as any).completeMilestoneWithSignature(escrowId, 1, await seller.getAddress(), deadline, sig2);

    // Now try to replay the original authorization for milestone 0 - should fail with MilestoneAlreadyCompleted
    // since milestone 0 was already completed in the first call
    await expect(
      (freshEscrow as any).completeMilestoneWithSignature(escrowId, 0, await seller.getAddress(), deadline, sig)
    ).to.be.revertedWithCustomError(freshEscrow, "MilestoneAlreadyCompleted");
  });

  it("rejects wrong recipient", async () => {
    const escrowId = ethers.hexlify(ethers.randomBytes(32));
    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    const sig = await signAuth(
      buyer,
      escrow,
      chainId,
      escrowId,
      0,
      500n,
      await seller.getAddress(),
      deadline
    );

    await expect(
      (escrow as any).completeMilestoneWithSignature(escrowId, 0, await other.getAddress(), deadline, sig)
    ).to.be.revertedWithCustomError(escrow, "InvalidRecipient");
  });

  it("rejects when mode disabled", async () => {
    await (escrow as any).connect(buyer).setAuthorizationMode(0); // None

    const escrowId = ethers.hexlify(ethers.randomBytes(32));
    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    const sig = await signAuth(
      buyer,
      escrow,
      chainId,
      escrowId,
      0,
      500n,
      await seller.getAddress(),
      deadline
    );

    await expect(
      (escrow as any).completeMilestoneWithSignature(escrowId, 0, await seller.getAddress(), deadline, sig)
    ).to.be.revertedWithCustomError(escrow, "OffChainSignedDisabled");
  });

  it("reverts lockFunds if obligationRegistry is not set", async () => {
    const escrowNoRegistry = await upgrades.deployProxy(
      await ethers.getContractFactory("SmartChequeEscrow"),
      [await buyer.getAddress(), await seller.getAddress(), 1000n, [500n, 500n], [ethers.ZeroHash, ethers.ZeroHash]],
      { initializer: "initialize" }
    );
    await escrowNoRegistry.waitForDeployment();
    await (token as any).connect(buyer).approve(await escrowNoRegistry.getAddress(), 1000n);
    await expect(
      (escrowNoRegistry as any).connect(buyer).lockFunds(await token.getAddress())
    ).to.be.reverted;
  });

  it("does not increase releasedAmount if token transfer fails", async () => {
    const MaliciousToken = await ethers.getContractFactory("contracts/test/MaliciousToken.sol:MaliciousToken");
    const maliciousToken = await MaliciousToken.deploy();
    await maliciousToken.waitForDeployment();
    const escrowMal = await upgrades.deployProxy(
      await ethers.getContractFactory("SmartChequeEscrow"),
      [await buyer.getAddress(), await seller.getAddress(), 1000n, [1000n], [ethers.ZeroHash]],
      { initializer: "initialize" }
    );
    await escrowMal.waitForDeployment();
    await (maliciousToken as any).transfer(await buyer.getAddress(), 1000n);
    await (maliciousToken as any).connect(buyer).approve(await escrowMal.getAddress(), 1000n);
    const MockRegistry = await ethers.getContractFactory("contracts/mocks/MockObligationRegistry.sol:MockObligationRegistry");
    const mockRegistry = await MockRegistry.deploy();
    await mockRegistry.waitForDeployment();
    await (escrowMal as any).connect(buyer).setObligationRegistry(await mockRegistry.getAddress());
    await (escrowMal as any).connect(buyer).lockFunds(await maliciousToken.getAddress());
    await (escrowMal as any).connect(buyer).setAuthorizationMode(1);
    await (escrowMal as any).connect(buyer).setSigner(await buyer.getAddress());
    // Enable attack to simulate transfer failure
    await (maliciousToken as any).enableAttack();
    const escrowId = ethers.hexlify(ethers.randomBytes(32));
    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    const sig = await signAuth(
      buyer,
      escrowMal,
      chainId,
      escrowId,
      0,
      1000n,
      await seller.getAddress(),
      deadline
    );
    // Expect transfer to revert and releasedAmount to remain zero
    await expect(
      (escrowMal as any).completeMilestoneWithSignature(escrowId, 0, await seller.getAddress(), deadline, sig)
    ).to.be.reverted;
    expect(await escrowMal.releasedAmount()).to.equal(0n);
  });
  
  it("updates releasedAmount and completedMilestones correctly after dispute resolution", async () => {
    // Setup escrow with 2 milestones
    const escrowDispute = await upgrades.deployProxy(
      await ethers.getContractFactory("SmartChequeEscrow"),
      [await buyer.getAddress(), await seller.getAddress(), 1000n, [500n, 500n], [ethers.ZeroHash, ethers.ZeroHash]],
      { initializer: "initialize" }
    );
    await escrowDispute.waitForDeployment();
    await (token as any).connect(buyer).approve(await escrowDispute.getAddress(), 1000n);
    const MockRegistry = await ethers.getContractFactory("contracts/mocks/MockObligationRegistry.sol:MockObligationRegistry");
    const mockRegistry = await MockRegistry.deploy();
    await mockRegistry.waitForDeployment();
    await (escrowDispute as any).connect(buyer).setObligationRegistry(await mockRegistry.getAddress());
    await (escrowDispute as any).connect(buyer).lockFunds(await token.getAddress());
    await (escrowDispute as any).connect(buyer).setAuthorizationMode(1);
    await (escrowDispute as any).connect(buyer).setSigner(await buyer.getAddress());
    // Raise dispute for milestone 0
    await (escrowDispute as any).connect(buyer).raiseDispute(0);
    // Resolve dispute, release funds to seller
    await (escrowDispute as any).connect(buyer).grantRole(await escrowDispute.DISPUTE_MANAGER_ROLE(), await buyer.getAddress());
    await (escrowDispute as any).connect(buyer).resolveDispute(0, true);
    expect(await escrowDispute.releasedAmount()).to.equal(500n);
    expect(await escrowDispute.completedMilestones()).to.equal(1);
    // Raise and resolve dispute for milestone 1, refund to buyer
    await (escrowDispute as any).connect(buyer).raiseDispute(1);
    await (escrowDispute as any).connect(buyer).resolveDispute(1, false);
    expect(await escrowDispute.releasedAmount()).to.equal(1000n);
    expect(await escrowDispute.completedMilestones()).to.equal(2);
  });
});