import { expect } from "chai";
import { ethers } from "hardhat";

describe("Simple Test", function () {
    it("should work", async function () {
        expect(1 + 1).to.equal(2);
    });

    it("should deploy MockERC20", async function () {
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const mockERC20 = await MockERC20.deploy("Test Token", "TEST", ethers.utils.parseEther("1000000"));
        await mockERC20.deployed();
        
        expect(await mockERC20.name()).to.equal("Test Token");
    });
});