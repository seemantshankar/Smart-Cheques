// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract MockOracle {
    bool public shouldVerify;
    bytes32 public lastObligationHash;
    address public lastOracleAddress;
    bytes public lastParameters;
    bytes public lastProof;
    
    event VerificationCalled(bytes32 indexed obligationHash, address indexed oracleAddress, bytes parameters, bytes proof);

    constructor(bool _shouldVerify) {
        shouldVerify = _shouldVerify;
    }

    function setVerificationResult(bool _shouldVerify) external {
        shouldVerify = _shouldVerify;
    }

    function verifyObligation(
        bytes32 obligationHash,
        address oracleAddress,
        bytes calldata parameters,
        bytes calldata proof
    ) external returns (bool) {
        lastObligationHash = obligationHash;
        lastOracleAddress = oracleAddress;
        lastParameters = parameters;
        lastProof = proof;
        
        emit VerificationCalled(obligationHash, oracleAddress, parameters, proof);
        
        return shouldVerify;
    }

    function getLastCallData() external view returns (
        bytes32 obligationHash,
        address oracleAddress,
        bytes memory parameters,
        bytes memory proof
    ) {
        return (lastObligationHash, lastOracleAddress, lastParameters, lastProof);
    }
}