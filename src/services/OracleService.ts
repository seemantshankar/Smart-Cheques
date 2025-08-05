import { ethers } from 'ethers';
import axios from 'axios';
import { db } from '../db';

interface OracleConfig {
  type: 'band' | 'chainlink';
  endpoint: string;
  apiKey?: string;
}

export class OracleService {
  private provider: ethers.providers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private obligationRegistry: ethers.Contract;
  private oracles: Map<string, OracleConfig>;

  constructor(rpcUrl: string, privateKey: string) {
    this.provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    
    this.obligationRegistry = new ethers.Contract(
      process.env.OBLIGATION_REGISTRY_ADDRESS!,
      [
        'function verifyObligation(bytes32 hash, bytes calldata data, uint8 v, bytes32 r, bytes32 s)',
        'function updateReliabilityScore(address oracle, uint256 score)'
      ],
      this.wallet
    );

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

  async verifyObligation(obligationHash: string): Promise<boolean> {
    try {
      // Get oracle data from database
      const oracleDataList = await db.getOracleDataByHash(obligationHash);
      
      if (oracleDataList.length === 0) {
        console.error(`No oracle data found for obligation ${obligationHash}`);
        return false;
      }

      // Aggregate responses from multiple oracles
      const responses = await Promise.all(
        oracleDataList.map(data => this.queryOracle(data.oracle_address, obligationHash))
      );

      // Filter out failed responses
      const validResponses = responses.filter(r => r !== null);
      
      if (validResponses.length === 0) {
        console.error(`No valid oracle responses for obligation ${obligationHash}`);
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

      return isVerified;
    } catch (error) {
      console.error(`Error verifying obligation ${obligationHash}:`, error);
      return false;
    }
  }

  private async queryOracle(oracleAddress: string, obligationHash: string): Promise<boolean | null> {
    const oracle = this.oracles.get(this.getOracleType(oracleAddress));
    
    if (!oracle) {
      console.error(`Unknown oracle address: ${oracleAddress}`);
      return null;
    }

    try {
      switch (oracle.type) {
        case 'band':
          return await this.queryBandProtocol(obligationHash, oracle);
        case 'chainlink':
          return await this.queryChainlink(obligationHash, oracle);
        default:
          console.error(`Unsupported oracle type: ${oracle.type}`);
          return null;
      }
    } catch (error) {
      console.error(`Error querying oracle ${oracleAddress}:`, error);
      return null;
    }
  }

  private async queryBandProtocol(obligationHash: string, config: OracleConfig): Promise<boolean> {
    const response = await axios.get(`${config.endpoint}/verify/${obligationHash}`, {
      headers: config.apiKey ? { 'X-API-Key': config.apiKey } : undefined
    });

    return response.data.verified;
  }

  private async queryChainlink(obligationHash: string, config: OracleConfig): Promise<boolean> {
    // Initialize Chainlink contract
    const chainlinkOracle = new ethers.Contract(
      config.endpoint,
      ['function verify(bytes32 hash) view returns (bool)'],
      this.provider
    );

    return await chainlinkOracle.verify(obligationHash);
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
      await this.obligationRegistry.updateReliabilityScore(
        update.address,
        update.score
      );
    }
  }
}