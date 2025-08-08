// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract MockObligationRegistry is Initializable {
    struct Obligation {
        bytes32 hash;
        address oracleAddress;
        bytes4 oracleFunction;
        bytes parameters;
        bool isVerified;
        uint256 verificationTimestamp;
    }

    mapping(bytes32 => Obligation) public obligations;
    mapping(bytes32 => bool) public shouldRevertOnVerify;
    mapping(bytes32 => bool) public verificationResults;

    event ObligationVerified(bytes32 indexed obligationId, bool success);

    function setVerified(bytes32 obligationId, bool verified) external {
        obligations[obligationId].isVerified = verified;
        if (verified) {
            obligations[obligationId].verificationTimestamp = block.timestamp;
        }
    }

    function setVerificationResult(bytes32 obligationId, bool result) external {
        verificationResults[obligationId] = result;
    }

    function setRevertOnVerify(bytes32 obligationId, bool shouldRevert) external {
        shouldRevertOnVerify[obligationId] = shouldRevert;
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
        if (shouldRevertOnVerify[obligationId]) {
            revert("Mock verification failed");
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