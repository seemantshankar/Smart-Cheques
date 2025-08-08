// SPDX-License-Identifier: MIT
import { ethers } from "hardhat";
import { expect } from "chai";
import { randomBytes } from "crypto";

/**
 * Helper functions for validator testing
 * Addresses validator slashing and activation test failures
 */
export class ValidatorTestHelper {
  static async setupValidator(
    validatorManager: any,
    governanceToken: any,
    validator: any,
    stakeAmount: any
  ) {
    // Approve tokens for staking
    await governanceToken.connect(validator).approve(
      await validatorManager.getAddress(),
      stakeAmount
    );
    
    // Register validator with proper parameters
    const publicKey = randomBytes(32);
    const moniker = "Test Validator";
    const commission = 1000; // 10%
    
    await validatorManager.connect(validator).registerValidator(
      stakeAmount,
      publicKey,
      moniker,
      commission
    );
    
    // Verify validator is active
    const isActive = await validatorManager.isValidatorActive(validator.target);
    expect(isActive).to.be.true;
    
    return {
      validator: validator.target,
      stakeAmount,
      publicKey,
      moniker,
      commission
    };
  }
  
  static async testValidatorSlashing(
    validatorManager: any,
    slasher: any,
    validatorAddress: string,
    slashAmount: any,
    reason: number = 0 // DOUBLE_SIGN
  ) {
    // Get initial state
    const initialStake = await validatorManager.getValidatorStake(validatorAddress);
    
    // Ensure slash amount is valid
    expect(slashAmount).to.be.lte(initialStake);
    
    // Perform slashing
    const evidence = randomBytes(32);
    await validatorManager.connect(slasher).slashValidator(
      validatorAddress,
      reason,
      slashAmount,
      evidence
    );
    
    // Verify slashing occurred
    const finalStake = await validatorManager.getValidatorStake(validatorAddress);
    expect(finalStake).to.equal(initialStake - slashAmount);
    
    return {
      initialStake,
      finalStake,
      slashedAmount: slashAmount
    };
  }
  
  static async testBlockProduction(
    validatorManager: any,
    oracle: any,
    validatorAddress: string,
    blockNumber: number
  ) {
    // Ensure validator is active before recording block production
    const isActive = await validatorManager.isValidatorActive(validatorAddress);
    expect(isActive).to.be.true;
    
    const isJailed = await validatorManager.isJailed(validatorAddress);
    expect(isJailed).to.be.false;
    
    // Record block production
    await validatorManager.connect(oracle).recordBlockProduction(
      validatorAddress,
      blockNumber
    );
    
    // Verify block was recorded
    const validatorInfo = await validatorManager.validators(validatorAddress);
    expect(validatorInfo.lastActiveBlock).to.be.gte(blockNumber);
    
    return validatorInfo;
  }
  
  static async jailValidator(
    validatorManager: any,
    slasher: any,
    validatorAddress: string,
    reason: number = 1 // DOWNTIME
  ) {
    await validatorManager.connect(slasher).jailValidator(
      validatorAddress,
      reason
    );
    
    // Verify validator is jailed
    const isJailed = await validatorManager.isJailed(validatorAddress);
    expect(isJailed).to.be.true;
    
    const isActive = await validatorManager.isValidatorActive(validatorAddress);
    expect(isActive).to.be.false;
  }
  
  static async unjailValidator(
    validatorManager: any,
    validator: any,
    jailDuration: number
  ) {
    // Advance time past jail duration
    await ethers.provider.send("evm_increaseTime", [jailDuration + 1]);
    await ethers.provider.send("evm_mine", []);
    
    // Unjail validator
    await validatorManager.connect(validator).unjailValidator();
    
    // Verify validator is no longer jailed
    const isJailed = await validatorManager.isJailed(validator.address);
    expect(isJailed).to.be.false;
  }
  
  static async setupMultipleValidators(
    validatorManager: any,
    governanceToken: any,
    validators: any[],
    stakeAmount: any
  ) {
    const validatorData = [];
    
    for (let i = 0; i < validators.length; i++) {
      const data = await this.setupValidator(
        validatorManager,
        governanceToken,
        validators[i],
        stakeAmount
      );
      validatorData.push(data);
    }
    
    return validatorData;
  }
}

/**
 * Example validator test implementation
 */
export const exampleValidatorTest = `
it("Should handle validator slashing correctly", async function() {
  // Setup validator
  const validatorData = await ValidatorTestHelper.setupValidator(
    validatorManager,
    governanceToken,
    validator,
    parseEther("1000")
  );
  
  // Test slashing
  const slashAmount = parseEther("100");
  await ValidatorTestHelper.testValidatorSlashing(
    validatorManager,
    slasher,
    validatorData.validator,
    slashAmount
  );
  
  // Verify validator state
  const isActive = await validatorManager.isValidatorActive(validatorData.validator);
  expect(isActive).to.be.true; // Should still be active after partial slash
});

it("Should handle block production correctly", async function() {
  // Setup active validator
  const validatorData = await ValidatorTestHelper.setupValidator(
    validatorManager,
    governanceToken,
    validator,
    parseEther("1000")
  );
  
  // Test block production
  await ValidatorTestHelper.testBlockProduction(
    validatorManager,
    oracle,
    validatorData.validator,
    12345
  );
});
`;