import { ethers } from 'ethers';
import { EventEmitter } from 'events';

// Simple Merkle Tree implementation
class SimpleMerkleTree {
  private leaves: string[];
  private tree: string[][];

  constructor(leaves: string[]) {
    this.leaves = leaves.length > 0 ? leaves : [ethers.keccak256('0x')];
    this.tree = this.buildTree();
  }

  private buildTree(): string[][] {
    const tree: string[][] = [this.leaves];
    let currentLevel = this.leaves;

    while (currentLevel.length > 1) {
      const nextLevel: string[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
        const combined = left <= right ? left + right.slice(2) : right + left.slice(2);
        nextLevel.push(ethers.keccak256(combined));
      }
      tree.push(nextLevel);
      currentLevel = nextLevel;
    }

    return tree;
  }

  getRoot(): string {
    return this.tree[this.tree.length - 1][0];
  }

  getProof(leaf: string): string[] {
    const proof: string[] = [];
    let index = this.leaves.indexOf(leaf);
    
    if (index === -1) return [];

    for (let level = 0; level < this.tree.length - 1; level++) {
      const isRightNode = index % 2 === 1;
      const siblingIndex = isRightNode ? index - 1 : index + 1;
      
      if (siblingIndex < this.tree[level].length) {
        proof.push(this.tree[level][siblingIndex]);
      }
      
      index = Math.floor(index / 2);
    }

    return proof;
  }
}

// Types
interface BridgeEvent {
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'CHALLENGE';
  transactionHash: string;
  blockNumber: number;
  timestamp: number;
  data: any;
}

interface DepositEvent extends BridgeEvent {
  type: 'DEPOSIT';
  data: {
    depositId: string;
    token: string;
    depositor: string;
    recipient: string;
    amount: string;
    isNative: boolean;
  };
}

interface WithdrawalEvent extends BridgeEvent {
  type: 'WITHDRAWAL';
  data: {
    withdrawalId: string;
    token: string;
    recipient: string;
    amount: string;
    l2TxHash: string;
    isNative: boolean;
  };
}

interface ValidatorSignature {
  validator: string;
  signature: string;
  timestamp: number;
}

interface RelayerConfig {
  l1Provider: ethers.Provider;
  l2Provider: ethers.Provider;
  l1BridgeAddress: string;
  l2BridgeAddress: string;
  nativeBridgeAddress: string;
  validatorPrivateKey: string;
  relayerPrivateKey: string;
  merkleUpdateInterval: number;
  challengePeriod: number;
  gasLimit: number;
  gasPrice: string;
}

/**
 * RelayerService handles cross-chain communication between L1 and L2
 * Monitors bridge events, generates Merkle proofs, and facilitates withdrawals
 */
export class RelayerService extends EventEmitter {
  private logger: any;
  private config: RelayerConfig;
  private l1Wallet: ethers.Wallet;
  private l2Wallet: ethers.Wallet;
  private l1Bridge: ethers.Contract;
  private l2Bridge: ethers.Contract;
  private nativeBridge: ethers.Contract;
  private isRunning: boolean = false;
  private pendingWithdrawals: Map<string, WithdrawalEvent> = new Map();
  private processedDeposits: Set<string> = new Set();
  private merkleTree: SimpleMerkleTree | null = null;
  private lastMerkleUpdate: number = 0;

  // Contract ABIs (simplified)
  private readonly BRIDGE_ABI = [
    'event TokenDeposited(bytes32 indexed depositId, address indexed token, address indexed depositor, address recipient, uint256 amount, uint256 blockNumber)',
    'event TokenWithdrawn(bytes32 indexed withdrawalId, address indexed token, address indexed recipient, uint256 amount, bytes32 l2TxHash)',
    'event NativeTokenDeposited(bytes32 indexed depositId, address indexed depositor, address indexed recipient, uint256 amount, uint256 blockNumber)',
    'event NativeTokenWithdrawn(bytes32 indexed withdrawalId, address indexed recipient, uint256 amount, bytes32 l2TxHash)',
    'function updateMerkleRoot(bytes32 newRoot, tuple(address validator, bytes signature, uint256 timestamp)[] validatorSignatures)',
    'function finalizeWithdrawal(bytes32 withdrawalId)',
    'function finalizeNativeWithdrawal(bytes32 withdrawalId)',
    'function currentMerkleRoot() view returns (bytes32)',
    'function getValidatorCount() view returns (uint256)'
  ];

  constructor(config: RelayerConfig) {
    super();
    this.config = config;
    
    // Initialize simple logger
    this.logger = {
      info: (message: string, meta?: any) => console.log(`[INFO] ${message}`, meta || ''),
      warn: (message: string, meta?: any) => console.warn(`[WARN] ${message}`, meta || ''),
      error: (message: string, meta?: any) => console.error(`[ERROR] ${message}`, meta || ''),
      debug: (message: string, meta?: any) => console.debug(`[DEBUG] ${message}`, meta || '')
    };

    // Initialize wallets
    this.l1Wallet = new ethers.Wallet(config.validatorPrivateKey, config.l1Provider);
    this.l2Wallet = new ethers.Wallet(config.relayerPrivateKey, config.l2Provider);

    // Initialize contracts
    this.l1Bridge = new ethers.Contract(config.l1BridgeAddress, this.BRIDGE_ABI, this.l1Wallet);
    this.l2Bridge = new ethers.Contract(config.l2BridgeAddress, this.BRIDGE_ABI, this.l2Wallet);
    this.nativeBridge = new ethers.Contract(config.nativeBridgeAddress, this.BRIDGE_ABI, this.l1Wallet);

    this.logger.info('RelayerService initialized', {
      l1BridgeAddress: config.l1BridgeAddress,
      l2BridgeAddress: config.l2BridgeAddress,
      nativeBridgeAddress: config.nativeBridgeAddress
    });
  }

  /**
   * Start the relayer service
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('RelayerService is already running');
      return;
    }

    this.logger.info('Starting RelayerService...');
    this.isRunning = true;

    try {
      // Start event listeners
      await this.startEventListeners();
      
      // Start periodic tasks
      this.startPeriodicTasks();
      
      this.logger.info('RelayerService started successfully');
      this.emit('started');
    } catch (error) {
      this.logger.error('Failed to start RelayerService', { error });
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Stop the relayer service
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.warn('RelayerService is not running');
      return;
    }

    this.logger.info('Stopping RelayerService...');
    this.isRunning = false;

    // Remove all listeners
    this.l1Bridge.removeAllListeners();
    this.l2Bridge.removeAllListeners();
    this.nativeBridge.removeAllListeners();

    this.logger.info('RelayerService stopped');
    this.emit('stopped');
  }

  /**
   * Start event listeners for bridge contracts
   */
  private async startEventListeners(): Promise<void> {
    // L1 ERC-20 Bridge Events
    this.l1Bridge.on('TokenDeposited', async (
      depositId: string,
      token: string,
      depositor: string,
      recipient: string,
      amount: ethers.BigNumber,
      blockNumber: number,
      event: ethers.Event
    ) => {
      await this.handleDepositEvent({
        type: 'DEPOSIT',
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        timestamp: Date.now(),
        data: {
          depositId,
          token,
          depositor,
          recipient,
          amount: amount.toString(),
          isNative: false
        }
      });
    });

    // L1 Native Bridge Events
    this.nativeBridge.on('NativeTokenDeposited', async (
      depositId: string,
      depositor: string,
      recipient: string,
      amount: ethers.BigNumber,
      blockNumber: number,
      event: ethers.Event
    ) => {
      await this.handleDepositEvent({
        type: 'DEPOSIT',
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        timestamp: Date.now(),
        data: {
          depositId,
          token: ethers.constants.AddressZero, // Native token
          depositor,
          recipient,
          amount: amount.toString(),
          isNative: true
        }
      });
    });

    // L2 Withdrawal Events
    this.l2Bridge.on('TokenWithdrawn', async (
      withdrawalId: string,
      token: string,
      recipient: string,
      amount: ethers.BigNumber,
      l2TxHash: string,
      event: ethers.Event
    ) => {
      await this.handleWithdrawalEvent({
        type: 'WITHDRAWAL',
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        timestamp: Date.now(),
        data: {
          withdrawalId,
          token,
          recipient,
          amount: amount.toString(),
          l2TxHash,
          isNative: false
        }
      });
    });

    this.logger.info('Event listeners started');
  }

  /**
   * Handle deposit events from L1
   */
  private async handleDepositEvent(event: DepositEvent): Promise<void> {
    const { depositId } = event.data;
    
    if (this.processedDeposits.has(depositId)) {
      this.logger.debug('Deposit already processed', { depositId });
      return;
    }

    this.logger.info('Processing deposit event', {
      depositId,
      token: event.data.token,
      amount: event.data.amount,
      isNative: event.data.isNative
    });

    try {
      // Process deposit on L2 (mint tokens)
      await this.processDepositOnL2(event);
      
      this.processedDeposits.add(depositId);
      this.emit('depositProcessed', event);
      
      this.logger.info('Deposit processed successfully', { depositId });
    } catch (error) {
      this.logger.error('Failed to process deposit', { depositId, error });
      this.emit('depositFailed', { event, error });
    }
  }

  /**
   * Handle withdrawal events from L2
   */
  private async handleWithdrawalEvent(event: WithdrawalEvent): Promise<void> {
    const { withdrawalId } = event.data;
    
    this.logger.info('Processing withdrawal event', {
      withdrawalId,
      token: event.data.token,
      amount: event.data.amount,
      isNative: event.data.isNative
    });

    // Store withdrawal for Merkle tree inclusion
    this.pendingWithdrawals.set(withdrawalId, event);
    
    this.emit('withdrawalReceived', event);
  }

  /**
   * Process deposit on L2 (mint tokens)
   */
  private async processDepositOnL2(event: DepositEvent): Promise<void> {
    // This would interact with L2 contracts to mint tokens
    // Implementation depends on L2 architecture
    
    const { depositId, token, recipient, amount, isNative } = event.data;
    
    // Simulate L2 processing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    this.logger.info('Tokens minted on L2', {
      depositId,
      token,
      recipient,
      amount,
      isNative
    });
  }

  /**
   * Generate Merkle tree from pending withdrawals
   */
  private generateMerkleTree(): SimpleMerkleTree {
    const leaves = Array.from(this.pendingWithdrawals.values()).map(withdrawal => {
      const { withdrawalId, token, recipient, amount, l2TxHash, isNative } = withdrawal.data;
      
      const leafData = isNative 
        ? ethers.utils.solidityPack(
            ['string', 'bytes32', 'address', 'uint256', 'uint256', 'bytes32'],
            ['NATIVE_WITHDRAWAL', withdrawalId, recipient, amount, withdrawal.blockNumber, l2TxHash]
          )
        : ethers.utils.solidityPack(
            ['bytes32', 'address', 'address', 'uint256', 'uint256', 'bytes32'],
            [withdrawalId, token, recipient, amount, withdrawal.blockNumber, l2TxHash]
          );
      
      return ethers.utils.keccak256(leafData);
    });

    return new SimpleMerkleTree(leaves);
  }

  /**
   * Update Merkle root on L1 bridge
   */
  private async updateMerkleRoot(): Promise<void> {
    if (this.pendingWithdrawals.size === 0) {
      this.logger.debug('No pending withdrawals, skipping Merkle root update');
      return;
    }

    try {
      this.merkleTree = this.generateMerkleTree();
      const newRoot = this.merkleTree.getRoot();
      
      // Get current root
      const currentRoot = await this.l1Bridge.currentMerkleRoot();
      
      if (currentRoot === newRoot) {
        this.logger.debug('Merkle root unchanged, skipping update');
        return;
      }

      // Generate validator signatures (simplified)
      const validatorSignatures = await this.generateValidatorSignatures(newRoot);
      
      // Update root on both bridges
      const tx1 = await this.l1Bridge.updateMerkleRoot(newRoot, validatorSignatures, {
        gasLimit: this.config.gasLimit,
        gasPrice: ethers.utils.parseUnits(this.config.gasPrice, 'gwei')
      });
      
      const tx2 = await this.nativeBridge.updateMerkleRoot(newRoot, validatorSignatures, {
        gasLimit: this.config.gasLimit,
        gasPrice: ethers.utils.parseUnits(this.config.gasPrice, 'gwei')
      });

      await Promise.all([tx1.wait(), tx2.wait()]);
      
      this.lastMerkleUpdate = Date.now();
      
      this.logger.info('Merkle root updated successfully', {
        newRoot,
        pendingWithdrawals: this.pendingWithdrawals.size,
        txHash1: tx1.hash,
        txHash2: tx2.hash
      });
      
      this.emit('merkleRootUpdated', { newRoot, pendingWithdrawals: this.pendingWithdrawals.size });
    } catch (error) {
      this.logger.error('Failed to update Merkle root', { error });
      this.emit('merkleRootUpdateFailed', { error });
    }
  }

  /**
   * Generate validator signatures for Merkle root update
   */
  private async generateValidatorSignatures(merkleRoot: string): Promise<ValidatorSignature[]> {
    // In a real implementation, this would collect signatures from multiple validators
    // For now, we'll simulate with a single validator signature
    
    const messageHash = ethers.utils.keccak256(
      ethers.utils.solidityPack(
        ['string', 'bytes32', 'uint256'],
        ['UPDATE_ROOT', merkleRoot, Date.now()]
      )
    );
    
    const signature = await this.l1Wallet.signMessage(ethers.utils.arrayify(messageHash));
    
    return [{
      validator: this.l1Wallet.address,
      signature,
      timestamp: Date.now()
    }];
  }

  /**
   * Generate Merkle proof for withdrawal
   */
  public generateMerkleProof(withdrawalId: string): string[] | null {
    if (!this.merkleTree || !this.pendingWithdrawals.has(withdrawalId)) {
      return null;
    }

    const withdrawal = this.pendingWithdrawals.get(withdrawalId)!;
    const { token, recipient, amount, l2TxHash, isNative } = withdrawal.data;
    
    const leafData = isNative 
      ? ethers.utils.solidityPack(
          ['string', 'bytes32', 'address', 'uint256', 'uint256', 'bytes32'],
          ['NATIVE_WITHDRAWAL', withdrawalId, recipient, amount, withdrawal.blockNumber, l2TxHash]
        )
      : ethers.utils.solidityPack(
          ['bytes32', 'address', 'address', 'uint256', 'uint256', 'bytes32'],
          [withdrawalId, token, recipient, amount, withdrawal.blockNumber, l2TxHash]
        );
    
    const leaf = ethers.utils.keccak256(leafData);
    const proof = this.merkleTree.getProof(leaf);
    
    return proof;
  }

  /**
   * Start periodic tasks
   */
  private startPeriodicTasks(): void {
    // Update Merkle root periodically
    setInterval(async () => {
      if (this.isRunning) {
        await this.updateMerkleRoot();
      }
    }, this.config.merkleUpdateInterval);

    // Clean up old processed deposits
    setInterval(() => {
      if (this.isRunning) {
        this.cleanupProcessedDeposits();
      }
    }, 60000); // Every minute

    this.logger.info('Periodic tasks started');
  }

  /**
   * Clean up old processed deposits to prevent memory leaks
   */
  private cleanupProcessedDeposits(): void {
    // Keep only recent deposits (last 24 hours)
    const cutoffTime = Date.now() - (24 * 60 * 60 * 1000);
    
    // This is a simplified cleanup - in production, you'd want to persist this data
    if (this.processedDeposits.size > 10000) {
      this.processedDeposits.clear();
      this.logger.info('Cleaned up processed deposits cache');
    }
  }

  /**
   * Get service status
   */
  public getStatus(): object {
    return {
      isRunning: this.isRunning,
      pendingWithdrawals: this.pendingWithdrawals.size,
      processedDeposits: this.processedDeposits.size,
      lastMerkleUpdate: this.lastMerkleUpdate,
      currentMerkleRoot: this.merkleTree?.getRoot() || null
    };
  }

  /**
   * Get pending withdrawals
   */
  public getPendingWithdrawals(): WithdrawalEvent[] {
    return Array.from(this.pendingWithdrawals.values());
  }

  /**
   * Manual Merkle root update trigger
   */
  public async triggerMerkleUpdate(): Promise<void> {
    await this.updateMerkleRoot();
  }
}