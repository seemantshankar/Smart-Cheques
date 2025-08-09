import { ethers } from 'ethers';
import axios from 'axios';
import { db } from '../db';
import winston from 'winston';

interface OracleConfig {
  type: 'band' | 'chainlink';
  endpoint: string;
  apiKey?: string;
}

export class OracleService {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private obligationRegistry: ethers.Contract;
  private oracles: Map<string, OracleConfig>;
  private logger: winston.Logger;

  constructor(rpcUrl: string, privateKey: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    this.obligationRegistry = new ethers.Contract(
      process.env.OBLIGATION_REGISTRY_ADDRESS!,
      [
        'function verifyObligation(bytes32 obligationId) returns (bool)',
        'function updateOracleScore(address oracle, uint8 newScore)'
      ],
      this.wallet
    );
    
    // Initialize logger
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      transports: [new winston.transports.Console()],
      format: winston.format.json()
    });

    // Initialize oracle configurations
    this.oracles = new Map([
      ['band', {
        type: 'band',
        endpoint: process.env.BAND_PROTOCOL_ENDPOINT!,
        apiKey: process.env.BAND_PROTOCOL_API_KEY
      }],
      ['chainlink', {
        type: 'chainlink',
        endpoint: process.env.CHAINLINK_NODE_ADDRESS!,
        apiKey: process.env.CHAINLINK_API_KEY
      }]
    ]);
  }

  async verifyObligation(obligationId: string): Promise<boolean> {
    try {
      // Get oracle data from database
      const oracleDataList = await db.getOracleDataByHash(obligationId);
      
      if (oracleDataList.length === 0) {
        this.logger.error(`No oracle data found for obligation ${obligationId}`);
        return false;
      }

      // Aggregate responses from multiple oracles
      const responses = await Promise.all(
        oracleDataList.map(data => this.queryOracle(data.oracle_address, obligationId))
      );

      // Filter out failed responses
      const validResponses = responses.filter(r => r !== null);
      
      if (validResponses.length === 0) {
        this.logger.error(`No valid oracle responses for obligation ${obligationId}`);
        return false;
      }

      // Calculate weighted average based on reliability scores
      const totalScore = oracleDataList.reduce((sum, data) => sum + data.reliability_score, 0);
      let weightedSum = 0;

      for (let i = 0; i < validResponses.length; i++) {
        const response = validResponses[i];
        const score = oracleDataList[i].reliability_score;
        weightedSum += (response ? 1 : 0) * (score / totalScore);
      }

      // Consider obligation verified if weighted average is above threshold
      const threshold = 0.7; // 70% threshold for verification
      const isVerified = weightedSum >= threshold;

      // Update oracle reliability scores based on consensus
      await this.updateReliabilityScores(oracleDataList, validResponses, isVerified);

      // Optionally trigger on-chain verification
      try {
        await this.obligationRegistry.verifyObligation(obligationId);
      } catch {
        // ignore failures to avoid blocking
      }

      return isVerified;
    } catch (error) {
      this.logger.error(`Error verifying obligation ${obligationId}:`, error);
      return false;
    }
  }

  private async queryOracle(oracleAddress: string, obligationHash: string): Promise<boolean | null> {
    const oracle = this.oracles.get(this.getOracleType(oracleAddress));
    
    if (!oracle) {
      this.logger.error(`Unknown oracle address: ${oracleAddress}`);
      return null;
    }

    try {
      switch (oracle.type) {
        case 'band':
          return await this.queryBandProtocol(obligationHash, oracle);
        case 'chainlink':
          return await this.queryChainlink(obligationHash, oracle);
        default:
          this.logger.error(`Unsupported oracle type: ${oracle.type}`);
          return null;
      }
    } catch (error) {
      this.logger.error(`Error querying oracle ${oracleAddress}:`, error);
      return null;
    }
  }

  private async queryBandProtocol(obligationId: string, config: OracleConfig): Promise<boolean> {
    const response = await axios.get(`${config.endpoint}/verify/${obligationId}`, {
      headers: config.apiKey ? { 'X-API-Key': config.apiKey } : undefined
    });

    return response.data.verified;
  }

  private async queryChainlink(obligationId: string, config: OracleConfig): Promise<boolean> {
    // Initialize Chainlink contract
    const chainlinkOracle = new ethers.Contract(
      config.endpoint,
      ['function verify(bytes32 hash) view returns (bool)'],
      this.provider
    );

    return await chainlinkOracle.verify(obligationId);
  }

  private getOracleType(oracleAddress: string): string {
    // Map oracle addresses to their types
    const addressMap: { [key: string]: string } = {
      [process.env.BAND_PROTOCOL_ADDRESS!]: 'band',
      [process.env.CHAINLINK_NODE_ADDRESS!]: 'chainlink'
    };

    return addressMap[oracleAddress.toLowerCase()] || 'unknown';
  }

  private async updateReliabilityScores(
    oracleDataList: any[],
    responses: (boolean | null)[],
    consensus: boolean
  ) {
    const scoreUpdates = [];

    for (let i = 0; i < oracleDataList.length; i++) {
      const oracleData = oracleDataList[i];
      const response = responses[i];

      if (response === null) {
        // Decrease score for failed responses
        scoreUpdates.push({
          address: oracleData.oracle_address,
          score: Math.max(0, oracleData.reliability_score - 1)
        });
      } else if (response === consensus) {
        // Increase score for correct responses
        scoreUpdates.push({
          address: oracleData.oracle_address,
          score: Math.min(100, oracleData.reliability_score + 1)
        });
      } else {
        // Decrease score for incorrect responses
        scoreUpdates.push({
          address: oracleData.oracle_address,
          score: Math.max(0, oracleData.reliability_score - 2)
        });
      }
    }

    // Update scores in smart contract
    for (const update of scoreUpdates) {
      await this.obligationRegistry.updateOracleScore(
        update.address,
        update.score
      );
    }
  }
}