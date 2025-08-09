// SPDX-License-Identifier: MIT
// Integration Test: End-to-End Escrow Flow

import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers.js";
import { MockERC20, SimpleEscrow } from "../../typechain";

describe("Integration: End-to-End Escrow Flow", function () {
    let owner: SignerWithAddress;
    let buyer: SignerWithAddress;
    let seller: SignerWithAddress;
    let arbitrator: SignerWithAddress;

    before(async function () {
        [owner, buyer, seller, arbitrator] = await ethers.getSigners();
    });

    async function deployContracts() {
        // Deploy mock token
        const MockToken = await ethers.getContractFactory("MockERC20");
        const token = await MockToken.deploy("Test Token", "TEST", ethers.parseEther("1000000"));
        await token.waitForDeployment();
        await token.mint(buyer.address, ethers.parseEther("1000"));
        
        // Deploy SimpleEscrow contract
        const SimpleEscrow = await ethers.getContractFactory("SimpleEscrow");
        
        const totalAmount = ethers.parseEther("1.0");
        const milestoneAmounts = [ethers.parseEther("0.5"), ethers.parseEther("0.5")];
        const obligations = [
            ethers.keccak256(ethers.toUtf8Bytes("Milestone 1: Design")),
            ethers.keccak256(ethers.toUtf8Bytes("Milestone 2: Development"))
        ];
        
        const escrow = await SimpleEscrow.deploy(
            buyer.address,
            seller.address,
            totalAmount,
            milestoneAmounts,
            obligations,
            owner.address,
            86400 // 1 day timelock
        );
        await escrow.waitForDeployment();
        
        return { token, escrow };
    }

    describe("Complete Escrow Lifecycle", function () {
        it("Should complete full escrow flow: fund -> milestone -> finalize", async function () {
            const { token, escrow } = await deployContracts();
            const totalAmount = ethers.parseEther("1.0");
            
            // Step 1: Buyer funds the escrow
            await token.connect(buyer).approve(await escrow.getAddress(), totalAmount);
            await escrow.connect(buyer).lockFunds(await token.getAddress(), totalAmount);
            
            // Verify funds are locked
            expect(await escrow.isLocked()).to.be.true;
            expect(await token.balanceOf(await escrow.getAddress())).to.equal(totalAmount);
            
            // Step 2: Complete first milestone
            const proof1 = ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["Design completed"]);
            await escrow.connect(seller).completeMilestone(0, proof1);
            
            // Verify milestone is ready for finalization (completion time is set)
            const completionTime1 = await escrow.milestoneCompletionTime(0);
            expect(completionTime1).to.be.gt(0);
            
            // Step 3: Complete second milestone
            const proof2 = ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["Development completed"]);
            await escrow.connect(seller).completeMilestone(1, proof2);
            
            // Verify second milestone is ready for finalization
            const completionTime2 = await escrow.milestoneCompletionTime(1);
            expect(completionTime2).to.be.gt(0);
            
            // Step 4: Finalize milestones (after timelock)
            // Fast forward time to bypass timelock
            await ethers.provider.send("evm_increaseTime", [86400]); // 1 day
            await ethers.provider.send("evm_mine", []);
            
            const sellerBalanceBefore = await token.balanceOf(seller.address);
            
            await escrow.finalizeMilestone(0);
            await escrow.finalizeMilestone(1);
            
            // Verify milestones are completed after finalization
            const milestone1Final = await escrow.getMilestone(0);
            const milestone2Final = await escrow.getMilestone(1);
            expect(milestone1Final.isCompleted).to.be.true;
            expect(milestone2Final.isCompleted).to.be.true;
            
            // Verify funds transferred to seller
            const sellerBalanceAfter = await token.balanceOf(seller.address);
            expect(sellerBalanceAfter - sellerBalanceBefore).to.equal(totalAmount);
            
            // Verify escrow is finalized
            expect(await escrow.isFinalized()).to.be.true;
        });

        it("Should handle dispute resolution flow", async function () {
            const { token, escrow } = await deployContracts();
            const totalAmount = ethers.parseEther("1.0");
            
            // Fund escrow
            await token.connect(buyer).approve(await escrow.getAddress(), totalAmount);
            await escrow.connect(buyer).lockFunds(await token.getAddress(), totalAmount);
            
            // Complete first milestone
            const proof = ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["Work completed"]);
            await escrow.connect(seller).completeMilestone(0, proof);
            
            // Raise dispute
            await escrow.connect(buyer).raiseDispute(0);
            
            // Verify dispute is raised
            const milestone = await escrow.getMilestone(0);
            expect(milestone.isDisputed).to.be.true;
            
            // Resolve dispute (admin resolves in favor of buyer - refund)
            await escrow.connect(owner).resolveDispute(0, false); // false = refund to buyer
            
            // Verify dispute resolution
            const resolvedMilestone = await escrow.getMilestone(0);
            expect(resolvedMilestone.isDisputed).to.be.false;
        });

        it("Should handle emergency pause and recovery", async function () {
            const { token, escrow } = await deployContracts();
            const totalAmount = ethers.parseEther("1.0");
            
            // Fund escrow
            await token.connect(buyer).approve(await escrow.getAddress(), totalAmount);
            await escrow.connect(buyer).lockFunds(await token.getAddress(), totalAmount);
            
            // Emergency pause
            await escrow.connect(owner).pause();
            
            // Verify contract is paused
            expect(await escrow.paused()).to.be.true;
            
            // Try to complete milestone while paused (should fail)
            const proof = ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["Work done"]);
            await expect(
                escrow.connect(seller).completeMilestone(0, proof)
            ).to.be.revertedWith("Pausable: paused");
            
            // Unpause
            await escrow.connect(owner).unpause();
            
            // Verify contract is unpaused
            expect(await escrow.paused()).to.be.false;
            
            // Now milestone completion should work
            await escrow.connect(seller).completeMilestone(0, proof);
            const completionTime = await escrow.milestoneCompletionTime(0);
            expect(completionTime).to.be.gt(0);
        });
    });
});