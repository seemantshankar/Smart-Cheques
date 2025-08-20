// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ObligationRegistry} from "../ObligationRegistry.sol";

// Note: Storage layout must be preserved. This V2 adds only a pure/view function.
contract ObligationRegistryV2 is ObligationRegistry {
    function version() external pure returns (uint256) {
        return 2;
    }
}


