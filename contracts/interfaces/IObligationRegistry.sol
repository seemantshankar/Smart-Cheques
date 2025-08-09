// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IObligationRegistry
 * @dev Interface for the ObligationRegistry contract
 */
interface IObligationRegistry {
    function verifyObligation(bytes32 obligationId) external returns (bool);
    function getObligation(bytes32 obligationId) external view returns (
        bytes32 hash,
        address oracleAddress,
        bytes4 oracleFunction,
        bytes memory parameters,
        bool isVerified,
        uint256 verificationTimestamp
    );
}