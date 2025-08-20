import { expect } from "chai";
import pkg from "hardhat";
const { ethers, upgrades } = pkg;

describe("Negative: direct upgrade reverts without timelock role", function () {
  it("reverts upgrade when caller lacks UPGRADER/ADMIN and timelock holds roles", async function () {
    const [deployer, other] = await ethers.getSigners();
    const ObligationRegistry = await ethers.getContractFactory("ObligationRegistry");
    const registry = await upgrades.deployProxy(ObligationRegistry, [], { initializer: "initialize", kind: "uups" });

    // Timelock placeholder takes roles
    const Timelock = await ethers.getContractFactory("SmartChequeTimelockController");
    const timelock = await Timelock.deploy(1, [deployer.address], [ethers.ZeroAddress], deployer.address);
    await registry.grantRole(await registry.DEFAULT_ADMIN_ROLE(), await timelock.getAddress());
    if (registry.functions["ADMIN_ROLE"]) {
      await registry.grantRole(await registry.ADMIN_ROLE(), await timelock.getAddress());
      try { await registry.revokeRole(await registry.ADMIN_ROLE(), deployer.address); } catch {}
    }
    try { await registry.revokeRole(await registry.DEFAULT_ADMIN_ROLE(), deployer.address); } catch {}

    // Attempt to upgrade from an EOA without privileges
    const V2Factory = await ethers.getContractFactory("contracts/mocks/ObligationRegistryV2.sol:ObligationRegistryV2");
    await expect(upgrades.upgradeProxy(await registry.getAddress(), V2Factory, { call: undefined, unsafeAllow: [] as any })).to.be.reverted;
  });
});


