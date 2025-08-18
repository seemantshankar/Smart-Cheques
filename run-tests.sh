#!/bin/bash

# Make the script exit on any error
set -e

# Function to run a test and report its status
run_test() {
  local test_file=$1
  echo "Running test: $test_file"
  if npx hardhat test "$test_file" --no-compile; then
    echo "✅ Test passed: $test_file"
    return 0
  else
    echo "❌ Test failed: $test_file"
    return 1
  fi
}

# Run each test individually
echo "=== Running individual tests ==="

# Simple test first to verify setup
run_test "test/SimpleTest.test.ts" || echo "Simple test failed but continuing"

# Bridge tests
run_test "test/BridgeRoles.test.ts" || echo "BridgeRoles test failed but continuing"

# Smart Cheque tests
run_test "test/unit/smartCheque.test.ts" || echo "smartCheque test failed but continuing"

# Arbitrator tests
run_test "test/unit/arbitrator.test.ts" || echo "arbitrator test failed but continuing"

# Consensus tests
run_test "test/ConsensusMinimal.test.ts" || echo "ConsensusMinimal test failed but continuing"

echo "=== Test run complete ==="