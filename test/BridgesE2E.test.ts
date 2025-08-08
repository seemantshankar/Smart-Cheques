import { expect } from "chai";
import { ethers } from "hardhat";

describe("Bridges e2e happy path", function () {
  it("should update root with validator signature quorum (simplified)", async function () {
    const [admin, validator] = await ethers.getSigners();
    const Bridge = await ethers.getContractFactory("ERC20Bridge");
    const bridge = await Bridge.deploy();
    await bridge.deployed();
    await bridge.initialize(admin.target, ethers.utils.parseEther("1"));
    await bridge.grantRole(await bridge.DEFAULT_ADMIN_ROLE(), admin.target);
    await bridge.addValidator(validator.target, ethers.utils.parseEther("10"));
    await bridge.grantRole(await bridge.RELAYER_ROLE(), admin.target);

    const newRoot = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("root"));
    const updateId = ethers.utils.keccak256(ethers.utils.solidityPack(["string","bytes32"],["UPDATE_ROOT", newRoot]));
    const signature = await validator.signMessage(ethers.utils.arrayify(updateId));
    const sig = { validator: validator.target, signature, timestamp: Date.now() };

    await expect(bridge.updateMerkleRoot(newRoot, [sig])).to.emit(bridge, 'MerkleRootUpdated');
  });
});


