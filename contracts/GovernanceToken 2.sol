// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC20BurnableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20BurnableUpgradeable.sol";
import {ERC20PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import {ERC20PermitUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import {ERC20VotesUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20VotesUpgradeable.sol";
import {ERC20FlashMintUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20FlashMintUpgradeable.sol";
import {IERC3156FlashBorrowerUpgradeable} from "@openzeppelin/contracts-upgradeable/interfaces/IERC3156FlashBorrowerUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";


/**
 * @title GovernanceToken
 * @dev ERC20 token with governance features, flash minting, and comprehensive security
 */
contract GovernanceToken is
    Initializable,
    ERC20Upgradeable,
    ERC20BurnableUpgradeable,
    ERC20PausableUpgradeable,
    ERC20PermitUpgradeable,
    ERC20VotesUpgradeable,
    ERC20FlashMintUpgradeable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    // Custom errors
    error MaxSupplyCannotBeLessThanCurrentSupply();
    error MintingCapMustBePositive();
    error MintingPeriodMustBePositive();
    error MintingPeriodTooLong();
    error FeeTooHigh();
    error MaxAmountTooHigh();
    error CannotBlacklistZeroAddress();
    error CannotWhitelistZeroAddress();
    error ExceedsMintingCapForCurrentPeriod();
    error AddressIsBlacklisted();
    error AddressNotWhitelisted();
    error CallerIsNotAFlashMinter();
    error FlashMintingIsDisabled();
    error UnsupportedToken();
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant FLASH_MINTER_ROLE = keccak256("FLASH_MINTER_ROLE");
    
    // Supply management
    uint256 public maxSupply;
    uint256 public mintingCap; // Maximum tokens that can be minted per period
    uint256 public mintingPeriod; // Time period for minting cap (e.g., 1 year)
    uint256 public lastMintingReset;
    uint256 public mintedInCurrentPeriod;
    
    // Flash mint controls
    uint256 public flashMintFee; // Fee in basis points (e.g., 50 = 0.5%)
    uint256 public maxFlashMintAmount;
    bool public flashMintEnabled;
    
    // Transfer restrictions
    mapping(address => bool) public blacklisted;
    mapping(address => bool) public whitelisted;
    bool public transferRestrictionsEnabled;

    // OZ upgradeable storage gap to allow future variable additions
    uint256[45] private __gap; // adjusted to account for newly added state below
    
    // Events
    event MaxSupplyUpdated(uint256 oldMaxSupply, uint256 newMaxSupply);
    event MintingCapUpdated(uint256 oldCap, uint256 newCap, uint256 oldPeriod, uint256 newPeriod);
    event FlashMintConfigUpdated(uint256 fee, uint256 maxAmount, bool enabled);
    event AddressBlacklisted(address indexed account, bool blacklisted);
    event AddressWhitelisted(address indexed account, bool whitelisted);
    event TransferRestrictionsToggled(bool enabled);
    event MintingPeriodReset(uint256 newPeriod);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        string memory name,
        string memory symbol,
        uint256 _maxSupply,
        uint256 _initialSupply,
        address _admin
    ) public initializer {
        require(_admin != address(0), "Invalid admin address");
        require(_maxSupply > 0, "Max supply must be positive");
        require(_initialSupply <= _maxSupply, "Initial supply exceeds max supply");
        
        __ERC20_init(name, symbol);
        __ERC20Burnable_init();
        __ERC20Pausable_init();
        __ERC20Permit_init(name);
        __ERC20Votes_init();
        __ERC20FlashMint_init();
        __AccessControl_init();
        __UUPSUpgradeable_init();
        
        // Set up roles
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(MINTER_ROLE, _admin);
        _grantRole(PAUSER_ROLE, _admin);
        _grantRole(UPGRADER_ROLE, _admin);
        _grantRole(FLASH_MINTER_ROLE, _admin);
        
        // Initialize supply management
        maxSupply = _maxSupply;
        mintingCap = _maxSupply / 10; // Default: 10% of max supply per year
        mintingPeriod = 365 days;
        lastMintingReset = block.timestamp;
        
        // Initialize flash mint settings
        flashMintFee = 50; // 0.5%
        maxFlashMintAmount = _maxSupply / 100; // 1% of max supply
        flashMintEnabled = true;
        
        // Mint initial supply
        if (_initialSupply > 0) {
            _mint(_admin, _initialSupply);
        }
    }

    /**
     * @dev Mints tokens to a specified address
     * @param to The address to mint tokens to
     * @param amount The amount of tokens to mint
     */
    function mint(address to, uint256 amount) public onlyRole(MINTER_ROLE) {
        require(to != address(0), "Cannot mint to zero address");
        require(amount > 0, "Amount must be positive");
        require(totalSupply() + amount <= maxSupply, "Exceeds max supply");
        
        _checkMintingCap(amount);
        _mint(to, amount);
    }

    /**
     * @dev Pauses all token transfers
     */
    function pause() public onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /**
     * @dev Unpauses all token transfers
     */
    function unpause() public onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /**
     * @dev Updates the maximum supply
     * @param _maxSupply The new maximum supply
     */
    function setMaxSupply(uint256 _maxSupply) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_maxSupply < totalSupply()) revert MaxSupplyCannotBeLessThanCurrentSupply();
        uint256 oldMaxSupply = maxSupply;
        maxSupply = _maxSupply;
        emit MaxSupplyUpdated(oldMaxSupply, _maxSupply);
    }

    /**
     * @dev Updates the minting cap and period
     * @param _mintingCap The new minting cap
     * @param _mintingPeriod The new minting period
     */
    function setMintingCap(uint256 _mintingCap, uint256 _mintingPeriod) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_mintingCap == 0) revert MintingCapMustBePositive();
        if (_mintingPeriod == 0) revert MintingPeriodMustBePositive();
        if (_mintingPeriod > 10 * 365 days) revert MintingPeriodTooLong();
        
        uint256 oldCap = mintingCap;
        uint256 oldPeriod = mintingPeriod;
        
        mintingCap = _mintingCap;
        mintingPeriod = _mintingPeriod;
        
        // Reset the period if we're changing the parameters
        lastMintingReset = block.timestamp;
        mintedInCurrentPeriod = 0;
        
        emit MintingCapUpdated(oldCap, _mintingCap, oldPeriod, _mintingPeriod);
    }

    /**
     * @dev Configures flash mint parameters
     * @param _fee Fee in basis points
     * @param _maxAmount Maximum flash mint amount
     * @param _enabled Whether flash minting is enabled
     */
    function setFlashMintConfig(
        uint256 _fee,
        uint256 _maxAmount,
        bool _enabled
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_fee > 1000) revert FeeTooHigh(); // Max 10%
        if (_maxAmount > maxSupply / 10) revert MaxAmountTooHigh(); // Max 10% of supply
        
        flashMintFee = _fee;
        maxFlashMintAmount = _maxAmount;
        flashMintEnabled = _enabled;
        
        emit FlashMintConfigUpdated(_fee, _maxAmount, _enabled);
    }

    /**
     * @dev Adds or removes an address from the blacklist
     * @param account The address to blacklist/unblacklist
     * @param _blacklisted Whether to blacklist the address
     */
    function setBlacklisted(address account, bool _blacklisted) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (account == address(0)) revert CannotBlacklistZeroAddress();
        blacklisted[account] = _blacklisted;
        emit AddressBlacklisted(account, _blacklisted);
    }

    /**
     * @dev Adds or removes an address from the whitelist
     * @param account The address to whitelist/unwhitelist
     * @param _whitelisted Whether to whitelist the address
     */
    function setWhitelisted(address account, bool _whitelisted) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (account == address(0)) revert CannotWhitelistZeroAddress();
        whitelisted[account] = _whitelisted;
        emit AddressWhitelisted(account, _whitelisted);
    }

    /**
     * @dev Toggles transfer restrictions
     * @param _enabled Whether transfer restrictions are enabled
     */
    function setTransferRestrictions(bool _enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        transferRestrictionsEnabled = _enabled;
        emit TransferRestrictionsToggled(_enabled);
    }

    /**
     * @dev Returns the flash mint fee for a given amount
     * @param amount The amount to flash mint
     * @return The fee amount
     */
    function flashFee(address, uint256 amount) public view override returns (uint256) {
        return (amount * flashMintFee) / 10000;
    }

    /**
     * @dev Returns the maximum flash mintable amount
     * @param token The token address (must be this contract)
     * @return The maximum amount
     */
    function maxFlashLoan(address token) public view override returns (uint256) {
        return token == address(this) && flashMintEnabled ? maxFlashMintAmount : 0;
    }

    /**
     * @dev Internal function to check minting cap
     * @param amount The amount to mint
     */
    function _checkMintingCap(uint256 amount) internal {
        // Reset period if needed
        if (block.timestamp >= lastMintingReset + mintingPeriod) {
            mintedInCurrentPeriod = 0;
            lastMintingReset = block.timestamp;
            emit MintingPeriodReset(block.timestamp);
        }
        
        if (mintedInCurrentPeriod + amount > mintingCap) revert ExceedsMintingCapForCurrentPeriod();
        mintedInCurrentPeriod += amount;
    }

    /**
     * @dev Internal function to check transfer restrictions
     * @param from The sender address
     * @param to The recipient address
     */
    function _checkTransferRestrictions(address from, address to) internal view {
        if (transferRestrictionsEnabled) {
            if (blacklisted[from] || blacklisted[to]) revert AddressIsBlacklisted();
            
            // If whitelist is active (contract itself is whitelisted), both parties must be whitelisted
            if (whitelisted[address(this)]) {
                if (!whitelisted[from] || !whitelisted[to]) revert AddressNotWhitelisted();
            }
        }
    }

    // Override functions to handle multiple inheritance
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override(ERC20Upgradeable, ERC20PausableUpgradeable) {
        // Check transfer restrictions
        if (from != address(0) && to != address(0)) {
            _checkTransferRestrictions(from, to);
        }
        
        super._beforeTokenTransfer(from, to, amount);
    }
    
    function _afterTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override(ERC20Upgradeable, ERC20VotesUpgradeable) {
        super._afterTokenTransfer(from, to, amount);
    }
    
    function _mint(
        address to,
        uint256 amount
    ) internal override(ERC20Upgradeable, ERC20VotesUpgradeable) {
        super._mint(to, amount);
    }
    
    function _burn(
        address account,
        uint256 amount
    ) internal override(ERC20Upgradeable, ERC20VotesUpgradeable) {
        super._burn(account, amount);
    }

    function _authorizeUpgrade(address newImplementation)
        internal
        override
        onlyRole(UPGRADER_ROLE)
    {}

    /**
     * @dev Override flash loan to add role-based access control and enforce token==this
     */
    function flashLoan(
        IERC3156FlashBorrowerUpgradeable receiver,
        address token,
        uint256 amount,
        bytes calldata data
    ) public override returns (bool) {
        if (!hasRole(FLASH_MINTER_ROLE, _msgSender())) revert CallerIsNotAFlashMinter();
        if (!flashMintEnabled) revert FlashMintingIsDisabled();
        if (token != address(this)) revert UnsupportedToken();
        return super.flashLoan(receiver, token, amount, data);
    }
}