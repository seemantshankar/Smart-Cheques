import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { Contract, Signer, ZeroHash, parseEther, hexlify, randomBytes } from "ethers";
import { MockERC20, SmartChequeEscrow } from "../typechain-types";

// EIP-712 helpers
const domain = (contract: Contract, chainId: number) => ({
  name: "SmartChequeEscrow",
  version: "1",
  chainId,
  verifyingContract: contract.target as string,
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
  chainId: number,
  escrowId: string,
  milestoneIndex: number,
  amount: bigint,
  recipient: string,
  deadline: number
) {
  const value = {
    contractAddress: contract.target as string,
    chainId,
    escrowId,
    milestoneIndex,
    amount,
    recipient,
    deadline,
  };
  return await signer.signTypedData(domain(contract, chainId), types, value);
}

describe("SmartChequeEscrow - OffChainSigned", function () {
  let buyer: Signer;
  let seller: Signer;
  let other: Signer;
  let token: MockERC20;
  let escrow: SmartChequeEscrow;
  let chainId: number;

  beforeEach(async () => {
    [buyer, seller, other] = await ethers.getSigners();

    token = (await ethers.getContractFactory("MockERC20").then(f => f.deploy("Test Token", "TEST", parseEther("1000000")))) as unknown as MockERC20;
    escrow = (await upgrades.deployProxy(
      await ethers.getContractFactory("SmartChequeEscrow"),
      [await buyer.getAddress(), await seller.getAddress(), 1000n, [500n, 500n], [ZeroHash, ZeroHash]],
      { initializer: "initialize" }
    )) as unknown as SmartChequeEscrow;
    await token.waitForDeployment();
    await escrow.waitForDeployment();

    chainId = (await ethers.provider.getNetwork()).chainId;

    // fund buyer and approve
    await token.mint(await buyer.getAddress(), 1000n);
    await token.connect(buyer).approve(escrow.address, 1000n);

    // lock funds
    await escrow.connect(buyer).lockFunds(token.address);

    // enable OffChainSigned and set signer
    await escrow.connect(buyer).setAuthorizationMode(1); // OffChainSigned
    await escrow.connect(buyer).setSigner(await buyer.getAddress());
  });

  it("completes milestone with valid signature", async () => {
    const escrowId = hexlify(randomBytes(32));
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
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
      escrow.completeMilestoneWithSignature(escrowId, 0, await seller.getAddress(), deadline, sig)
    )
      .to.emit(escrow, "AuthorizationConsumed")
      .and.to.emit(escrow, "MilestoneCompleted");

    expect(await token.balanceOf(await seller.getAddress())).to.equal(500n);
  });

  it("rejects with expired deadline", async () => {
    const escrowId = hexlify(randomBytes(32));
    const latest = await ethers.provider.getBlock("latest");
    const deadline = (latest?.timestamp || 0) - 1;
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
      escrow.completeMilestoneWithSignature(escrowId, 0, await seller.getAddress(), deadline, sig)
    ).to.be.revertedWith("Authorization expired");
  });

  it("rejects when signer mismatch", async () => {
    await escrow.connect(buyer).setSigner(await other.getAddress());

    const escrowId = hexlify(randomBytes(32));
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
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
      escrow.completeMilestoneWithSignature(escrowId, 0, await seller.getAddress(), deadline, sig)
    ).to.be.revertedWith("Invalid signature");
  });

  it("rejects replay of same authorization", async () => {
    const escrowId = hexlify(randomBytes(32));
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
    const sig = await signAuth(
      buyer,
      escrow,
      chainId,
      escrowId,
      1,
      500n,
      await seller.getAddress(),
      deadline
    );

    await expect(
      escrow.completeMilestoneWithSignature(escrowId, 1, await seller.getAddress(), deadline, sig)
    ).to.emit(escrow, "AuthorizationConsumed");

    // attempt replay
    await expect(
      escrow.completeMilestoneWithSignature(escrowId, 1, await seller.getAddress(), deadline, sig)
    ).to.be.revertedWith("Authorization already used");
  });

  it("rejects wrong recipient", async () => {
    const escrowId = hexlify(randomBytes(32));
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
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
      escrow.completeMilestoneWithSignature(escrowId, 0, await other.getAddress(), deadline, sig)
    ).to.be.revertedWith("Invalid recipient");
  });

  it("rejects when mode disabled", async () => {
    await escrow.connect(buyer).setAuthorizationMode(0); // None

    const escrowId = hexlify(randomBytes(32));
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
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
      escrow.completeMilestoneWithSignature(escrowId, 0, await seller.getAddress(), deadline, sig)
    ).to.be.revertedWith("OffChainSigned disabled");
  });
});