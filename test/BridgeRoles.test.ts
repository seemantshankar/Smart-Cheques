import { expect } from "chai";
import { ethers } from "hardhat";

describe("ERC20Bridge roles", function () {
  it("RELAYER_ROLE can update root; others cannot. VALIDATOR add/remove flows", async function () {
    const [admin, relayer, other, v1] = await ethers.getSigners();
    const Bridge = await ethers.getContractFactory("ERC20Bridge");
    const bridge = await Bridge.deploy();
    await bridge.deployed();
    await bridge.initialize(admin.target, ethers.utils.parseEther("1"));

    // Grant roles
    await bridge.grantRole(await bridge.RELAYER_ROLE(), relayer.target);
    await bridge.addValidator(v1.target, ethers.utils.parseEther("5"));

    const newRoot = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("root2"));
    const updateId = ethers.utils.keccak256(ethers.utils.solidityPack(["string","bytes32"],["UPDATE_ROOT", newRoot]));
    const sig = await v1.signMessage(ethers.utils.arrayify(updateId));
    const signatures = [{ validator: v1.target, signature: sig, timestamp: Date.now() }];

    // Non-relayer should fail
    await expect(bridge.connect(other).updateMerkleRoot(newRoot, signatures)).to.be.reverted;
    // Relayer succeeds
    await expect(bridge.connect(relayer).updateMerkleRoot(newRoot, signatures)).to.emit(bridge, 'MerkleRootUpdated');

    // Remove validator
    await bridge.removeValidator(v1.target);
  });
});


