// SPDX-License-Identifier: MIT
import { ethers } from "hardhat";
import { expect } from "chai";
import { keccak256, toUtf8Bytes } from "ethers/lib/utils";

/**
 * Helper functions for governance testing
 * Addresses the "unknown proposal ID" test failures
 */
export class GovernanceTestHelper {
  static async createTestProposal(
    governor: any,
    escrowContract: any,
    description: string = "Test proposal"
  ) {
    // Prepare proposal parameters
    const targets = [escrowContract.address];
    const values = [0];
    const calldatas = [
      escrowContract.interface.encodeFunctionData("pause", [])
    ];
    
    // Create proposal using enhanced validation
    const tx = await governor.proposeWithValidation(
      targets,
      values,
      calldatas,
      description
    );
    await tx.wait();
    
    // Calculate proposal ID
    const proposalId = await governor.hashProposal(
      targets,
      values,
      calldatas,
      keccak256(toUtf8Bytes(description))
    );
    
    // Verify proposal exists
    const exists = await governor.proposalExists(proposalId);
    expect(exists).to.be.true;
    
    return {
      proposalId,
      targets,
      values,
      calldatas,
      description
    };
  }
  
  static async advanceBlocks(blocks: number) {
    for (let i = 0; i < blocks; i++) {
      await ethers.provider.send("evm_mine", []);
    }
  }
  
  static async advanceTime(seconds: number) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }
  
  static async executeProposalFlow(
    governor: any,
    voter: any,
    proposalData: any,
    votingPeriod: number,
    eta: number
  ) {
    const { proposalId, targets, values, calldatas, description } = proposalData;
    
    // Vote on proposal
    await governor.connect(voter).castVote(proposalId, 1); // Vote "For"
    
    // Advance through voting period
    await this.advanceBlocks(votingPeriod + 1);
    
    // Queue proposal
    const descriptionHash = keccak256(toUtf8Bytes(description));
    await governor.queue(targets, values, calldatas, descriptionHash);
    
    // Advance time for timelock
    await this.advanceTime(eta + 1);
    
    // Execute proposal
    await governor.execute(targets, values, calldatas, descriptionHash);
    
    return proposalId;
  }
  
  static async getProposalState(governor: any, proposalId: any) {
    const details = await governor.getProposalDetails(proposalId);
    return {
      state: details.state_,
      snapshot: details.snapshot,
      deadline: details.deadline
    };
  }
}

/**
 * Example test implementation showing proper usage
 */
export const exampleGovernanceTest = `
it("Should handle governance proposal execution correctly", async function() {
  // Create proposal with proper validation
  const proposalData = await GovernanceTestHelper.createTestProposal(
    governor,
    escrowContract,
    "Emergency pause proposal"
  );
  
  // Execute full proposal flow
  await GovernanceTestHelper.executeProposalFlow(
    governor,
    voter,
    proposalData,
    votingPeriod,
    eta
  );
  
  // Verify execution
  const finalState = await GovernanceTestHelper.getProposalState(
    governor,
    proposalData.proposalId
  );
  
  expect(finalState.state).to.equal(7); // Executed state
});
`;