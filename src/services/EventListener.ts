import { ethers } from 'ethers';
import { db } from '../db';

interface ContractConfig {
  address: string;
  abi: any[];
  fromBlock: number;
  events: string[];
}

export class EventListener {
  private provider: ethers.providers.JsonRpcProvider;
  private contracts: Map<string, ethers.Contract>;
  private chainId: number;

  constructor(rpcUrl: string) {
    this.provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    this.contracts = new Map();
    this.chainId = 0;
  }

  async initialize() {
    const network = await this.provider.getNetwork();
    this.chainId = network.chainId;

    // Initialize contract configs
    const contracts: ContractConfig[] = [
      {
        address: process.env.FACTORY_ADDRESS!,
        abi: [
          'event ChequeCreated(uint256 indexed chequeId, address indexed buyer, address indexed seller)',
          'event ChequeUpdated(uint256 indexed chequeId, uint8 status)'
        ],
        fromBlock: parseInt(process.env.START_BLOCK || '0'),
        events: ['ChequeCreated', 'ChequeUpdated']
      },
      {
        address: process.env.OBLIGATION_REGISTRY_ADDRESS!,
        abi: [
          'event ObligationRegistered(bytes32 indexed obligationId, bytes32 hash, address indexed oracleAddress)',
          'event ObligationVerified(bytes32 indexed obligationId, bool success, uint256 timestamp)'
        ],
        fromBlock: parseInt(process.env.START_BLOCK || '0'),
        events: ['ObligationRegistered', 'ObligationVerified']
      },
      {
        address: process.env.DISPUTE_MANAGER_ADDRESS!,
        abi: [
          'event DisputeOpened(uint256 indexed disputeId, address indexed cheque, uint256 milestoneId)',
          'event DisputeResolved(uint256 indexed disputeId, uint8 resolutionType)'
        ],
        fromBlock: parseInt(process.env.START_BLOCK || '0'),
        events: ['DisputeOpened', 'DisputeResolved']
      }
    ];

    // Initialize contracts and event listeners
    for (const config of contracts) {
      const contract = new ethers.Contract(config.address, config.abi, this.provider);
      this.contracts.set(config.address, contract);

      // Start listening to events
      this.listenToEvents(contract, config.events);

      // Fetch historical events
      await this.fetchHistoricalEvents(contract, config.fromBlock, config.events);
    }
  }

  private listenToEvents(contract: ethers.Contract, events: string[]) {
    for (const eventName of events) {
      contract.on(eventName, async (...args) => {
        const event = args[args.length - 1];
        await this.handleEvent(contract.address, eventName, event);
      });
    }
  }

  private async fetchHistoricalEvents(contract: ethers.Contract, fromBlock: number, events: string[]) {
    const latestBlock = await this.provider.getBlockNumber();
    const batchSize = 1000;

    for (let startBlock = fromBlock; startBlock <= latestBlock; startBlock += batchSize) {
      const endBlock = Math.min(startBlock + batchSize - 1, latestBlock);

      for (const eventName of events) {
        const filter = contract.filters[eventName]();
        const events = await contract.queryFilter(filter, startBlock, endBlock);

        for (const event of events) {
          await this.handleEvent(contract.address, eventName, event);
        }
      }
    }
  }

  private async handleEvent(contractAddress: string, eventName: string, event: ethers.Event) {
    try {
      // Store event in database
      await db.createEvent({
        chain_id: this.chainId,
        contract_address: contractAddress,
        event_name: eventName,
        transaction_hash: event.transactionHash,
        block_number: event.blockNumber,
        log_index: event.logIndex,
        parameters: event.args || {}
      });

      // Handle specific events
      switch (eventName) {
        case 'ChequeCreated':
          await this.handleChequeCreated(event);
          break;
        case 'ChequeUpdated':
          await this.handleChequeUpdated(event);
          break;
        case 'DisputeOpened':
          await this.handleDisputeOpened(event);
          break;
        case 'DisputeResolved':
          await this.handleDisputeResolved(event);
          break;
        case 'ObligationRegistered':
          await this.handleObligationRegistered(event);
          break;
        case 'ObligationVerified':
          await this.handleObligationVerified(event);
          break;
      }
    } catch (error) {
      console.error(`Error handling event ${eventName}:`, error);
    }
  }

  private async handleChequeCreated(event: ethers.Event) {
    const [chequeId, buyer, seller] = event.args!;
    
    // Get cheque details from contract
    const factory = this.contracts.get(process.env.FACTORY_ADDRESS!)!;
    const chequeAddress = await factory.getChequeAddress(chequeId);
    
    // Create cheque record
    await db.createCheque({
      chain_id: this.chainId,
      cheque_id: chequeId.toString(),
      contract_address: chequeAddress,
      buyer_address: buyer,
      seller_address: seller,
      total_amount: '0', // Will be updated when fetching full details
      status: 0
    });
  }

  private async handleChequeUpdated(event: ethers.Event) {
    const [chequeId, status] = event.args!;
    // Update cheque status in database
    // Implementation depends on database schema and requirements
  }

  private async handleDisputeOpened(event: ethers.Event) {
    const [disputeId, chequeAddress, milestoneId] = event.args!;
    
    // Get dispute details from contract
    const disputeManager = this.contracts.get(process.env.DISPUTE_MANAGER_ADDRESS!)!;
    const dispute = await disputeManager.getDispute(disputeId);
    
    // Create dispute record
    await db.createDispute({
      chain_id: this.chainId,
      dispute_id: disputeId.toString(),
      cheque_id: chequeAddress,
      milestone_id: milestoneId.toString(),
      initiator_address: dispute.initiator,
      reason: dispute.reason,
      evidence: dispute.evidence,
      status: 0
    });
  }

  private async handleDisputeResolved(event: ethers.Event) {
    const [disputeId, resolutionType] = event.args!;
    // Update dispute status in database
    // Implementation depends on database schema and requirements
  }

  private async handleObligationRegistered(event: ethers.Event) {
    const [obligationId, _hash, oracleAddress] = event.args!;
    await db.createOracleData({
      obligation_hash: obligationId,
      oracle_address: oracleAddress,
      data_hash: ethers.constants.HashZero,
      reliability_score: 0
    });
  }

  private async handleObligationVerified(event: ethers.Event) {
    const [_obligationId, _success] = event.args!;
    // Optionally persist verification outcome; current schema stores oracle_data only
  }

  async stop() {
    // Remove all event listeners
    for (const contract of this.contracts.values()) {
      contract.removeAllListeners();
    }
  }
}