// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract DebugEncoder {
    function encodeAndHash(
        bytes[] memory transactions,
        bytes[] memory receipts,
        bytes[] memory merkleProofs
    ) external pure returns (bytes32) {
        return keccak256(abi.encode(transactions, receipts, merkleProofs));
    }
    
    function justEncode(
        bytes[] memory transactions,
        bytes[] memory receipts,
        bytes[] memory merkleProofs
    ) external pure returns (bytes memory) {
        return abi.encode(transactions, receipts, merkleProofs);
    }
}