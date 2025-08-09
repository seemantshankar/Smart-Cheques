import { expect } from "chai";
import { ethers } from "hardhat";

describe("ERC20Bridge roles", function () {
  it("RELAYER_ROLE can update root; others cannot. VALIDATOR add/remove flows", async function () {
    const [admin, relayer, other, v1] = await ethers.getSigners();
    const Bridge = await ethers.getContractFactory("ERC20Bridge");
    const bridge = await Bridge.deploy();
    await bridge.waitForDeployment();
    await bridge.initialize(admin.address, ethers.parseEther("1"));

    // Grant roles
    await bridge.grantRole(await bridge.RELAYER_ROLE(), relayer.address);
    await bridge.addValidator(v1.address, ethers.parseEther("5"));

    const newRoot = ethers.keccak256(ethers.toUtf8Bytes("root2"));
    const updateId = ethers.keccak256(ethers.solidityPacked(["string","bytes32"],["UPDATE_ROOT", newRoot]));
    const sig = await v1.signMessage(ethers.getBytes(updateId));
    const signatures = [{ validator: v1.address, signature: sig, timestamp: Date.now() }];

    // Non-relayer should fail
    await expect(bridge.connect(other).updateMerkleRoot(newRoot, signatures)).to.be.reverted;
    // Relayer succeeds
    await expect(bridge.connect(relayer).updateMerkleRoot(newRoot, signatures)).to.emit(bridge, 'MerkleRootUpdated');

    // Remove validator
    await bridge.removeValidator(v1.address);
  });
});


