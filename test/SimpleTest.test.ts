import { expect } from "chai";
import { ethers } from "hardhat";
import { parseEther } from "ethers";

describe("Simple Test", function () {
    it("should work", async function () {
        expect(1 + 1).to.equal(2);
    });

    it("should deploy MockERC20", async function () {
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const mockERC20 = await MockERC20.deploy("Test Token", "TEST", parseEther("1000000"));
        await mockERC20.waitForDeployment();
        
        expect(await mockERC20.name()).to.equal("Test Token");
    });
});