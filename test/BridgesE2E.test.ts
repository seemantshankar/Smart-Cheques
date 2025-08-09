import { expect } from "chai";
import { ethers } from "hardhat";
import { parseEther, keccak256, toUtf8Bytes, solidityPacked, getBytes } from "ethers";

describe("Bridges e2e happy path", function () {
  it("should update root with validator signature quorum (simplified)", async function () {
    const [admin, validator] = await ethers.getSigners();
    const Bridge = await ethers.getContractFactory("ERC20Bridge");
    const bridge = await Bridge.deploy();
    await bridge.waitForDeployment();
    await bridge.initialize(admin.address, parseEther("1"));
    await bridge.grantRole(await bridge.DEFAULT_ADMIN_ROLE(), admin.address);
    await bridge.addValidator(validator.address, parseEther("10"));
    await bridge.grantRole(await bridge.RELAYER_ROLE(), admin.address);

    const newRoot = keccak256(toUtf8Bytes("root"));
    const updateId = keccak256(solidityPacked(["string","bytes32"],["UPDATE_ROOT", newRoot]));
    const signature = await validator.signMessage(getBytes(updateId));
    const sig = { validator: validator.address, signature, timestamp: Date.now() };

    await expect(bridge.updateMerkleRoot(newRoot, [sig])).to.emit(bridge, 'MerkleRootUpdated');
  });
});


