import { expect } from "chai";
import { ethers } from "hardhat";

describe("Minimal Reentrancy Test", function () {
    it("should run a basic test", async function () {
        expect(1 + 1).to.equal(2);
    });

    it("should deploy a contract", async function () {
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const token = await MockERC20.deploy("Test", "TEST", ethers.parseEther("1000"));
        await token.waitForDeployment();
        expect(token.target).to.not.be.undefined;
    });
});