// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IObligationRegistry.sol";

contract MaliciousObligationRegistry is IObligationRegistry {
    struct Obligation {
        bytes32 hash;
        address oracleAddress;
        bytes4 oracleFunction;
        bytes parameters;
        bool isVerified;
        uint256 verificationTimestamp;
    }

    mapping(bytes32 => Obligation) public obligations;
    mapping(bytes32 => bool) public verificationResults;
    
    address public targetEscrow;
    uint256 public attackMode; // 0: normal, 1: reentrancy, 2: nested reentrancy
    uint256 public attackCount;

    event ObligationVerified(bytes32 indexed obligationId, bool success);

    function setTargetEscrow(address _targetEscrow) external {
        targetEscrow = _targetEscrow;
    }

    function setAttackMode(uint256 _mode) external {
        attackMode = _mode;
        attackCount = 0;
    }

    function setVerificationResult(bytes32 obligationId, bool result) external {
        verificationResults[obligationId] = result;
    }

    function setObligation(
        bytes32 obligationId,
        bytes32 hash,
        address oracleAddress,
        bytes4 oracleFunction,
        bytes memory parameters,
        bool isVerified,
        uint256 verificationTimestamp
    ) external {
        obligations[obligationId] = Obligation({
            hash: hash,
            oracleAddress: oracleAddress,
            oracleFunction: oracleFunction,
            parameters: parameters,
            isVerified: isVerified,
            verificationTimestamp: verificationTimestamp
        });
    }

    function verifyObligation(bytes32 obligationId) external returns (bool) {
        attackCount++;
        
        if (attackMode == 1 && attackCount == 1) {
            // Attempt reentrancy attack via completeMilestone
            targetEscrow.call(
                abi.encodeWithSignature("completeMilestone(uint256,bytes)", 0, "0x1234")
            );
            // This should fail due to reentrancy protection
        }
        
        if (attackMode == 2 && attackCount <= 2) {
            // Attempt nested reentrancy
            targetEscrow.call(
                abi.encodeWithSignature("completeMilestone(uint256,bytes)", 1, "0x1234")
            );
        }

        bool result = verificationResults[obligationId];
        if (!obligations[obligationId].isVerified && result) {
            obligations[obligationId].isVerified = true;
            obligations[obligationId].verificationTimestamp = block.timestamp;
        }
        
        emit ObligationVerified(obligationId, result);
        return result;
    }

    function getObligation(bytes32 obligationId) external view returns (
        bytes32 hash,
        address oracleAddress,
        bytes4 oracleFunction,
        bytes memory parameters,
        bool isVerified,
        uint256 verificationTimestamp
    ) {
        Obligation memory obligation = obligations[obligationId];
        return (
            obligation.hash,
            obligation.oracleAddress,
            obligation.oracleFunction,
            obligation.parameters,
            obligation.isVerified,
            obligation.verificationTimestamp
        );
    }

    function isObligationVerified(bytes32 obligationId) external view returns (bool) {
        return obligations[obligationId].isVerified;
    }
}