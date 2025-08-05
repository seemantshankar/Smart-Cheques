import { expect } from "chai";
import { ethers } from "hardhat";

describe("Minimal Reentrancy Test", function () {
    it("should run a basic test", async function () {
        expect(1 + 1).to.equal(2);
    });

    it("should deploy a contract", async function () {
        const [owner] = await ethers.getSigners();
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const token = await MockERC20.deploy("Test", "TEST", ethers.utils.parseEther("1000"));
        await token.deployed();
        expect(token.address).to.not.be.undefined;
    });
});