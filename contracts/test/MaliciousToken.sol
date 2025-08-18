// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Bridge} from "../bridge/ERC20Bridge.sol";

/**
 * @title MaliciousToken
 * @dev A malicious ERC20 token that attempts reentrancy attacks
 */
contract MaliciousToken is ERC20 {
    ERC20Bridge public bridge;
    address public attacker;
    uint256 public attackCount;
    bool public shouldAttack;
    
    constructor() ERC20("MaliciousToken", "MAL") {
        _mint(msg.sender, 1000000 * 10**18);
    }
    
    function setBridge(address _bridge) external {
        bridge = ERC20Bridge(_bridge);
    }
    
    function setAttacker(address _attacker) external {
        attacker = _attacker;
    }
    
    function enableAttack() external {
        shouldAttack = true;
        attackCount = 0;
    }
    
    function disableAttack() external {
        shouldAttack = false;
    }
    
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) public override returns (bool) {
        if (shouldAttack) {
            revert("MaliciousToken: transferFrom attack simulated");
        }
        // Perform the normal transfer first
        bool success = super.transferFrom(from, to, amount);
        
        // Attempt reentrancy attack if enabled
        if (shouldAttack && attackCount < 3 && address(bridge) != address(0)) {
            attackCount++;
            try bridge.depositToken(address(this), 100, attacker) {
                // Attack succeeded (this should not happen with proper protection)
            } catch {
                // Attack failed (expected with reentrancy protection)
            }
        }
        
        return success;
    }
}