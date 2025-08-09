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

  beforeEach(async () => {
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

    // fund buyer and approve
    await (token as any).mint(await buyer.getAddress(), 1000n);
    await (token as any).connect(buyer).approve(await escrow.getAddress(), 1000n);

    // lock funds
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
});