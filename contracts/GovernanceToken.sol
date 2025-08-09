// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title GovernanceToken
 * @dev ERC20 token with voting capabilities for Smart Cheque governance
 * @notice This token is used for governance voting and validator staking
 */
contract GovernanceToken is ERC20, ERC20Permit, ERC20Votes, Ownable, Pausable, ReentrancyGuard {
    // Custom errors
    error ExceedsMaxSupply();
    error InsufficientBalance();
    error InsufficientStake();
    error NotValidator();
    error AlreadyValidator();
    error StakingDelayNotMet();
    error InvalidAmount();

    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 10**18; // 1 billion tokens
    uint256 public constant INITIAL_SUPPLY = 100_000_000 * 10**18; // 100 million tokens
    
    // Staking related variables
    mapping(address => uint256) public stakedBalances;
    mapping(address => uint256) public stakingTimestamp;
    mapping(address => bool) public isValidator;
    
    uint256 public totalStaked;
    uint256 public minStakeAmount = 10_000 * 10**18; // 10k tokens minimum
    uint256 public stakingRewardRate = 5; // 5% annual reward
    uint256 public unstakingDelay = 7 days;
    
    // Events
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event ValidatorAdded(address indexed validator);
    event ValidatorRemoved(address indexed validator);
    event RewardsClaimed(address indexed user, uint256 amount);
    
    constructor() 
        ERC20("Smart Cheque Governance Token", "SCGT")
        ERC20Permit("Smart Cheque Governance Token")
    {
        _mint(msg.sender, INITIAL_SUPPLY);
    }
    
    /**
     * @dev Stake tokens for governance voting and validator eligibility
     * @param amount Amount of tokens to stake
     */
    function stake(uint256 amount) external nonReentrant whenNotPaused {
        if (amount < minStakeAmount) revert InsufficientStake();
        if (balanceOf(msg.sender) < amount) revert InsufficientBalance();
        
        // Transfer tokens to contract
        _transfer(msg.sender, address(this), amount);
        
        // Update staking records
        stakedBalances[msg.sender] += amount;
        stakingTimestamp[msg.sender] = block.timestamp;
        totalStaked += amount;
        
        // Delegate voting power to self
        if (delegates(msg.sender) == address(0)) {
            _delegate(msg.sender, msg.sender);
        }
        
        emit Staked(msg.sender, amount);
    }
    
    /**
     * @dev Unstake tokens after delay period
     * @param amount Amount of tokens to unstake
     */
    function unstake(uint256 amount) external nonReentrant {
        if (stakedBalances[msg.sender] < amount) revert InsufficientBalance();
        if (block.timestamp < stakingTimestamp[msg.sender] + unstakingDelay) revert StakingDelayNotMet();
        
        // Update staking records
        stakedBalances[msg.sender] -= amount;
        totalStaked -= amount;
        
        // Remove validator status if stake falls below minimum
        if (stakedBalances[msg.sender] < minStakeAmount && isValidator[msg.sender]) {
            isValidator[msg.sender] = false;
            emit ValidatorRemoved(msg.sender);
        }
        
        // Transfer tokens back to user
        _transfer(address(this), msg.sender, amount);
        
        emit Unstaked(msg.sender, amount);
    }
    
    /**
     * @dev Apply to become a validator
     */
    function becomeValidator() external {
        if (stakedBalances[msg.sender] < minStakeAmount) revert InsufficientStake();
        if (isValidator[msg.sender]) revert AlreadyValidator();
        
        isValidator[msg.sender] = true;
        emit ValidatorAdded(msg.sender);
    }
    
    /**
     * @dev Calculate staking rewards for a user
     * @param user Address to calculate rewards for
     * @return rewards Amount of rewards earned
     */
    function calculateRewards(address user) public view returns (uint256 rewards) {
        if (stakedBalances[user] == 0) return 0;
        
        uint256 stakingDuration = block.timestamp - stakingTimestamp[user];
        uint256 annualReward = (stakedBalances[user] * stakingRewardRate) / 100;
        rewards = (annualReward * stakingDuration) / 365 days;
    }
    
    /**
     * @dev Claim staking rewards
     */
    function claimRewards() external nonReentrant whenNotPaused {
        uint256 rewards = calculateRewards(msg.sender);
        if (rewards == 0) revert InvalidAmount();
        if (totalSupply() + rewards > MAX_SUPPLY) revert ExceedsMaxSupply();
        
        // Reset staking timestamp
        stakingTimestamp[msg.sender] = block.timestamp;
        
        // Mint rewards
        _mint(msg.sender, rewards);
        
        emit RewardsClaimed(msg.sender, rewards);
    }
    
    /**
     * @dev Slash validator stake for misbehavior
     * @param validator Validator to slash
     * @param slashAmount Amount to slash
     */
    function slash(address validator, uint256 slashAmount) external onlyOwner {
        if (!isValidator[validator]) revert NotValidator();
        if (stakedBalances[validator] < slashAmount) revert InsufficientBalance();
        
        stakedBalances[validator] -= slashAmount;
        totalStaked -= slashAmount;
        
        // Remove validator status if stake falls below minimum
        if (stakedBalances[validator] < minStakeAmount) {
            isValidator[validator] = false;
            emit ValidatorRemoved(validator);
        }
        
        // Burn slashed tokens
        _burn(address(this), slashAmount);
    }
    
    /**
     * @dev Set minimum stake amount (governance function)
     * @param newMinStake New minimum stake amount
     */
    function setMinStakeAmount(uint256 newMinStake) external onlyOwner {
        minStakeAmount = newMinStake;
    }
    
    /**
     * @dev Set staking reward rate (governance function)
     * @param newRate New reward rate (percentage)
     */
    function setStakingRewardRate(uint256 newRate) external onlyOwner {
        if (newRate > 20) revert InvalidAmount(); // Max 20%
        stakingRewardRate = newRate;
    }
    
    /**
     * @dev Pause contract functions
     */
    function pause() external onlyOwner {
        _pause();
    }
    
    /**
     * @dev Unpause contract functions
     */
    function unpause() external onlyOwner {
        _unpause();
    }
    
    /**
     * @dev Get voting power including staked tokens
     * @param account Account to get voting power for
     * @return Voting power amount
     */
    function getVotingPower(address account) external view returns (uint256) {
        return getVotes(account) + stakedBalances[account];
    }
    
    // Override required functions
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override whenNotPaused {
        super._beforeTokenTransfer(from, to, amount);
    }
    
    function _afterTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override(ERC20, ERC20Votes) {
        super._afterTokenTransfer(from, to, amount);
    }
    
    function _mint(address to, uint256 amount) internal override(ERC20, ERC20Votes) {
        super._mint(to, amount);
    }
    
    function _burn(address account, uint256 amount) internal override(ERC20, ERC20Votes) {
        super._burn(account, amount);
    }
}