// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title GovernanceToken
 * @dev ERC20 token with voting capabilities for Smart Cheque governance
 * @notice This token is used for governance voting and validator staking
 */
contract GovernanceToken is ERC20, ERC20Permit, ERC20Votes, Ownable, Pausable, ReentrancyGuard {
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
        require(amount >= minStakeAmount, "Amount below minimum stake");
        require(balanceOf(msg.sender) >= amount, "Insufficient balance");
        
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
        require(stakedBalances[msg.sender] >= amount, "Insufficient staked balance");
        require(
            block.timestamp >= stakingTimestamp[msg.sender] + unstakingDelay,
            "Unstaking delay not met"
        );
        
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
        require(stakedBalances[msg.sender] >= minStakeAmount, "Insufficient stake for validator");
        require(!isValidator[msg.sender], "Already a validator");
        
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
        require(rewards > 0, "No rewards to claim");
        require(totalSupply() + rewards <= MAX_SUPPLY, "Would exceed max supply");
        
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
        require(isValidator[validator], "Not a validator");
        require(stakedBalances[validator] >= slashAmount, "Insufficient stake to slash");
        
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
        require(newRate <= 20, "Reward rate too high"); // Max 20%
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