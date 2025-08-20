import { expect } from "chai";
import pkg from "hardhat";
const { ethers, upgrades } = pkg;
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("Timelock-controlled UUPS upgrade flow", function () {
  it("enforces upgrade only via governor->timelock queue/execute", async function () {
    const [deployer, voter1, voter2] = await ethers.getSigners();

    // Deploy GovernanceToken
    const GovernanceTokenFactory = await ethers.getContractFactory("contracts/GovernanceToken.sol:GovernanceToken");
    const governanceToken = await GovernanceTokenFactory.deploy();

    // Deploy Timelock (1 hour delay)
    const Timelock = await ethers.getContractFactory("SmartChequeTimelockController");
    const timelock = await Timelock.deploy(3600, [deployer.address], [ethers.ZeroAddress], deployer.address);

    // Deploy Governor
    const Governor = await ethers.getContractFactory("SmartChequeGovernor");
    const governor = await Governor.deploy(await governanceToken.getAddress(), await timelock.getAddress(), ethers.parseEther("1000"));

    // Wire proposer/executor
    await timelock.grantRole(await timelock.PROPOSER_ROLE(), await governor.getAddress());
    await timelock.grantRole(await timelock.EXECUTOR_ROLE(), ethers.ZeroAddress);
    await timelock.grantRole(await timelock.DEFAULT_ADMIN_ROLE(), await timelock.getAddress());
    await timelock.revokeRole(await timelock.DEFAULT_ADMIN_ROLE(), deployer.address);

    // Deploy ObligationRegistry proxy (UUPS)
    const ObligationRegistry = await ethers.getContractFactory("ObligationRegistry");
    const registry = await upgrades.deployProxy(ObligationRegistry, [], { initializer: "initialize", kind: "uups" });

    // Grant admin/upgrader to timelock and revoke deployer
    await registry.grantRole(await registry.DEFAULT_ADMIN_ROLE(), await timelock.getAddress());
    if (registry.functions["ADMIN_ROLE"]) {
      await registry.grantRole(await registry.ADMIN_ROLE(), await timelock.getAddress());
      await registry.revokeRole(await registry.ADMIN_ROLE(), deployer.address);
    }
    await registry.revokeRole(await registry.DEFAULT_ADMIN_ROLE(), deployer.address);

    // Fund governance voting power
    await governanceToken.transfer(voter1.address, ethers.parseEther("3000000"));
    await governanceToken.transfer(voter2.address, ethers.parseEther("2000000"));
    await governanceToken.connect(voter1).delegate(voter1.address);
    await governanceToken.connect(voter2).delegate(voter2.address);
    await governanceToken.connect(deployer).delegate(deployer.address);

    // Prepare V2 implementation
    const V2Factory = await ethers.getContractFactory("contracts/mocks/ObligationRegistryV2.sol:ObligationRegistryV2");
    const v2Impl = await V2Factory.deploy();

    // Attempt direct upgrade should revert (no upgrader role on deployer)
    await expect(upgrades.upgradeProxy(await registry.getAddress(), V2Factory)).to.be.reverted;

    // Prepare governance proposal to call upgrade via UUPS pattern
    // Encode upgradeTo call using proxy admin pattern: UUPS upgrade is triggered by calling upgradeTo on the proxy itself
    const calldata = registry.interface.encodeFunctionData("upgradeTo", [await v2Impl.getAddress()]);

    const description = "Upgrade ObligationRegistry to V2";
    const tx = await governor.connect(voter1).propose(
      [await registry.getAddress()],
      [0],
      [calldata],
      description
    );
    const receipt = await tx.wait();
    const proposalId = receipt.logs?.map((l: any) => {
      try { return governor.interface.parseLog(l); } catch { return null; }
    }).find((e: any) => e && e.name === "ProposalCreated")?.args?.proposalId;

    // Move to voting
    await time.advanceBlock();
    await governor.connect(voter1).castVote(proposalId, 1);
    await governor.connect(voter2).castVote(proposalId, 1);
    await time.advanceBlockTo((await ethers.provider.getBlockNumber()) + 6);

    // Queue
    const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description));
    await governor.queue([await registry.getAddress()], [0], [calldata], descriptionHash);

    // Wait delay
    await time.increase(3600 + 1);
    await time.advanceBlock();

    // Execute
    await governor.execute([await registry.getAddress()], [0], [calldata], descriptionHash);

    // Verify new behavior exists
    const v = await (await ethers.getContractAt("contracts/mocks/ObligationRegistryV2.sol:ObligationRegistryV2", await registry.getAddress())).version();
    expect(v).to.equal(2);
  });
});


