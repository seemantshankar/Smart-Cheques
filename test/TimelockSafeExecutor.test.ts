import { expect } from "chai";
import pkg from "hardhat";
const { ethers, upgrades } = pkg;
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("Timelock with multisig (Safe) as EXECUTOR", function () {
  it("allows Safe (executor) to execute queued operation scheduled by Governor", async function () {
    const [deployer, voter1, voter2, safeExec] = await ethers.getSigners();

    // Governance token
    const GovernanceTokenFactory = await ethers.getContractFactory("contracts/GovernanceToken.sol:GovernanceToken");
    const governanceToken = await GovernanceTokenFactory.deploy();

    // Timelock with Safe as executor
    const Timelock = await ethers.getContractFactory("SmartChequeTimelockController");
    const minDelay = 3600;
    const timelock = await Timelock.deploy(minDelay, [deployer.address], [safeExec.address], deployer.address);

    // Governor
    const Governor = await ethers.getContractFactory("SmartChequeGovernor");
    const governor = await Governor.deploy(await governanceToken.getAddress(), await timelock.getAddress(), ethers.parseEther("1000"));

    // Wire roles: proposer = governor, executor = safeExec
    await timelock.grantRole(await timelock.PROPOSER_ROLE(), await governor.getAddress());
    // self-admin and revoke deployer admin
    await timelock.grantRole(await timelock.DEFAULT_ADMIN_ROLE(), await timelock.getAddress());
    await timelock.revokeRole(await timelock.DEFAULT_ADMIN_ROLE(), deployer.address);

    // Target: ObligationRegistry (UUPS)
    const ObligationRegistry = await ethers.getContractFactory("ObligationRegistry");
    const registry = await upgrades.deployProxy(ObligationRegistry, [], { initializer: "initialize", kind: "uups" });

    // Grant admin to timelock
    await registry.grantRole(await registry.DEFAULT_ADMIN_ROLE(), await timelock.getAddress());
    try { await registry.revokeRole(await registry.DEFAULT_ADMIN_ROLE(), deployer.address); } catch {}

    // Distribute voting power
    await governanceToken.transfer(voter1.address, ethers.parseEther("3000000"));
    await governanceToken.transfer(voter2.address, ethers.parseEther("2000000"));
    await governanceToken.connect(voter1).delegate(voter1.address);
    await governanceToken.connect(voter2).delegate(voter2.address);
    await governanceToken.connect(deployer).delegate(deployer.address);

    // Proposal: updateMinimumOracleScore(80)
    const calldata = registry.interface.encodeFunctionData("updateMinimumOracleScore", [80]);
    const description = "Param change via Safe executor";
    const proposeTx = await governor.connect(voter1).propose([await registry.getAddress()], [0], [calldata], description);
    const receipt = await proposeTx.wait();
    const proposalId = receipt.logs?.map((l: any) => { try { return governor.interface.parseLog(l); } catch { return null; } }).find((e: any) => e && e.name === "ProposalCreated")?.args?.proposalId;

    await time.advanceBlock();
    await governor.connect(voter1).castVote(proposalId, 1);
    await governor.connect(voter2).castVote(proposalId, 1);
    await time.advanceBlockTo((await ethers.provider.getBlockNumber()) + 6);

    // Queue via governor
    const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description));
    await governor.queue([await registry.getAddress()], [0], [calldata], descriptionHash);

    // Execute directly via timelock by Safe executor account
    await time.increase(minDelay + 1);
    await time.advanceBlock();
    await expect(
      timelock.connect(safeExec).execute(
        await registry.getAddress(),
        0,
        calldata,
        ethers.ZeroHash, // predecessor
        descriptionHash   // salt
      )
    ).to.emit(registry, "MinimumOracleScoreUpdated").withArgs(80);

    expect(await registry.minimumOracleScore()).to.equal(80);
  });
});


