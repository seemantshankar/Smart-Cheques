// SPDX-License-Identifier: MIT
import { ethers } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers.js";
import { AbiCoder, keccak256, hashMessage, getBytes } from "ethers";

/**
 * Helper functions for authorization and escrow testing
 * Addresses authorization replay protection test failures
 */
export class AuthorizationTestHelper {
  static async createMilestoneAuthorization(
    escrowId: number,
    milestoneIndex: number,
    amount: any,
    recipient: string,
    deadline: number,
    signer: HardhatEthersSigner
  ) {
    // Create the authorization data
    const authData = AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256", "uint256", "address", "uint256"],
      [escrowId, milestoneIndex, amount, recipient, deadline]
    );
    
    // Create message hash
    const messageHash = keccak256(authData);
    const ethSignedMessageHash = hashMessage(
      getBytes(messageHash)
    );
    
    // Sign the message
    const signature = await signer.signMessage(getBytes(messageHash));
    
    return {
      authData,
      messageHash,
      ethSignedMessageHash,
      signature,
      deadline
    };
  }
  
  static async testAuthorizationReplayProtection(
    escrowContract: any,
    escrowId: number,
    milestoneIndex: number,
    amount: any,
    recipient: string,
    signer: HardhatEthersSigner
  ) {
    const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    
    // Create authorization
    const auth = await this.createMilestoneAuthorization(
      escrowId,
      milestoneIndex,
      amount,
      recipient,
      deadline,
      signer
    );
    
    // First use should succeed
    await escrowContract.completeMilestoneWithAuthorization(
      escrowId,
      milestoneIndex,
      amount,
      recipient,
      deadline,
      auth.signature
    );
    
    // Second use should fail with replay protection
    await expect(
      escrowContract.completeMilestoneWithAuthorization(
        escrowId,
        milestoneIndex,
        amount,
        recipient,
        deadline,
        auth.signature
      )
    ).to.be.revertedWith("Authorization already used");
    
    return auth;
  }
  
  static async createEscrowWithMilestones(
    escrowFactory: any,
    token: any,
    buyer: HardhatEthersSigner,
    seller: HardhatEthersSigner,
    totalAmount: any,
    milestoneAmounts: any[]
  ) {
    // Approve tokens
    await token.connect(buyer).approve(escrowFactory.target, totalAmount);
    
    // Create escrow
    const tx = await escrowFactory.connect(buyer).createEscrow(
      seller.address,
      token.target,
      totalAmount,
      milestoneAmounts,
      "Test escrow"
    );
    
    const receipt = await tx.wait();
    const escrowCreatedEvent = receipt.events?.find(
      (e: any) => e.event === "EscrowCreated"
    );
    
    const escrowId = escrowCreatedEvent?.args?.escrowId;
    const escrowAddress = escrowCreatedEvent?.args?.escrowContract;
    
    return {
      escrowId,
      escrowAddress,
      buyer: buyer.address,
      seller: seller.address,
      totalAmount,
      milestoneAmounts
    };
  }
  
  static async setupAuthorizationTest(
    escrowFactory: any,
    token: any,
    buyer: HardhatEthersSigner,
    seller: HardhatEthersSigner,
    signer: HardhatEthersSigner,
    totalAmount: any
  ) {
    // Setup milestone amounts
    const milestoneAmounts = [
      totalAmount.div(3),
      totalAmount.div(3),
      totalAmount.sub(totalAmount.div(3).mul(2))
    ];
    
    // Create escrow
    const escrowData = await this.createEscrowWithMilestones(
      escrowFactory,
      token,
      buyer,
      seller,
      totalAmount,
      milestoneAmounts
    );
    
    // Get escrow contract instance
    const escrowContract = await ethers.getContractAt(
      "SmartChequeEscrow",
      escrowData.escrowAddress
    );
    
    // Set authorization signer (if method exists)
    // Note: setSigner method may not exist in all contract versions
    // Skipping setSigner call as it's not available on BaseContract
    
    return {
      ...escrowData,
      escrowContract
    };
  }
  
  static async testMilestoneCompletion(
    escrowContract: any,
    escrowId: number,
    milestoneIndex: number,
    amount: any,
    recipient: string,
    signer: HardhatEthersSigner
  ) {
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    
    // Create and use authorization
    const auth = await this.createMilestoneAuthorization(
      escrowId,
      milestoneIndex,
      amount,
      recipient,
      deadline,
      signer
    );
    
    // Complete milestone
    await escrowContract.completeMilestoneWithAuthorization(
      escrowId,
      milestoneIndex,
      amount,
      recipient,
      deadline,
      auth.signature
    );
    
    // Verify milestone is completed
    const milestone = await escrowContract.getMilestone(escrowId, milestoneIndex);
    expect(milestone.isCompleted).to.be.true;
    
    return milestone;
  }
  
  static async advanceTime(seconds: number) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }
  
  static async testExpiredAuthorization(
    escrowContract: any,
    escrowId: number,
    milestoneIndex: number,
    amount: any,
    recipient: string,
    signer: HardhatEthersSigner
  ) {
    const shortDeadline = Math.floor(Date.now() / 1000) + 60; // 1 minute
    
    // Create authorization with short deadline
    const auth = await this.createMilestoneAuthorization(
      escrowId,
      milestoneIndex,
      amount,
      recipient,
      shortDeadline,
      signer
    );
    
    // Advance time past deadline
    await this.advanceTime(120); // 2 minutes
    
    // Should fail with expired authorization
    await expect(
      escrowContract.completeMilestoneWithAuthorization(
        escrowId,
        milestoneIndex,
        amount,
        recipient,
        shortDeadline,
        auth.signature
      )
    ).to.be.revertedWith("Authorization expired");
  }
}

/**
 * Example authorization test implementation
 */
export const exampleAuthorizationTest = `
it("Should prevent authorization replay attacks", async function() {
  // Setup escrow with authorization
  const escrowData = await AuthorizationTestHelper.setupAuthorizationTest(
    escrowFactory,
    token,
    buyer,
    seller,
    signer,
    parseEther("1000")
  );
  
  // Test replay protection
  await AuthorizationTestHelper.testAuthorizationReplayProtection(
    escrowData.escrowContract,
    escrowData.escrowId,
    0, // First milestone
    escrowData.milestoneAmounts[0],
    seller.address,
    signer
  );
});

it("Should handle expired authorizations", async function() {
  const escrowData = await AuthorizationTestHelper.setupAuthorizationTest(
    escrowFactory,
    token,
    buyer,
    seller,
    signer,
    parseEther("1000")
  );
  
  await AuthorizationTestHelper.testExpiredAuthorization(
    escrowData.escrowContract,
    escrowData.escrowId,
    0,
    escrowData.milestoneAmounts[0],
    seller.address,
    signer
  );
});
`;