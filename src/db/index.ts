import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

export interface User {
  id: string;
  address: string;
  nonce: number;
  created_at: Date;
  updated_at: Date;
}

export interface Cheque {
  id: string;
  chain_id: number;
  cheque_id: string;
  contract_address: string;
  buyer_address: string;
  seller_address: string;
  total_amount: string;
  status: number;
  created_at: Date;
  updated_at: Date;
}

export interface Milestone {
  id: string;
  cheque_id: string;
  milestone_index: number;
  amount: string;
  description: string;
  obligation: string;
  proof?: string;
  is_completed: boolean;
  completed_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface Dispute {
  id: string;
  chain_id: number;
  dispute_id: string;
  cheque_id: string;
  milestone_id: string;
  initiator_address: string;
  arbitrator_address?: string;
  reason: string;
  evidence: string;
  status: number;
  resolution_type?: number;
  resolution_amount?: string;
  resolved_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface OracleData {
  id: string;
  obligation_hash: string;
  oracle_address: string;
  data_hash: string;
  reliability_score: number;
  created_at: Date;
  updated_at: Date;
}

export interface Event {
  id: string;
  chain_id: number;
  contract_address: string;
  event_name: string;
  transaction_hash: string;
  block_number: number;
  log_index: number;
  parameters: Record<string, any>;
  created_at: Date;
}

export class DB {
  private pool: Pool;

  constructor() {
    this.pool = pool;
  }

  // User operations
  async createUser(address: string): Promise<User> {
    const result = await this.pool.query(
      'INSERT INTO users (address) VALUES ($1) RETURNING *',
      [address]
    );
    return result.rows[0];
  }

  async getUserByAddress(address: string): Promise<User | null> {
    const result = await this.pool.query(
      'SELECT * FROM users WHERE address = $1',
      [address]
    );
    return result.rows[0] || null;
  }

  // Cheque operations
  async createCheque(cheque: Omit<Cheque, 'id' | 'created_at' | 'updated_at'>): Promise<Cheque> {
    const result = await this.pool.query(
      `INSERT INTO cheques (
        chain_id, cheque_id, contract_address, buyer_address, seller_address,
        total_amount, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        cheque.chain_id,
        cheque.cheque_id,
        cheque.contract_address,
        cheque.buyer_address,
        cheque.seller_address,
        cheque.total_amount,
        cheque.status
      ]
    );
    return result.rows[0];
  }

  async getChequeById(id: string): Promise<Cheque | null> {
    const result = await this.pool.query(
      'SELECT * FROM cheques WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  async getChequesByAddress(address: string): Promise<Cheque[]> {
    const result = await this.pool.query(
      'SELECT * FROM cheques WHERE buyer_address = $1 OR seller_address = $1 ORDER BY created_at DESC',
      [address]
    );
    return result.rows;
  }

  // Milestone operations
  async createMilestone(milestone: Omit<Milestone, 'id' | 'created_at' | 'updated_at'>): Promise<Milestone> {
    const result = await this.pool.query(
      `INSERT INTO milestones (
        cheque_id, milestone_index, amount, description, obligation, is_completed
      ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        milestone.cheque_id,
        milestone.milestone_index,
        milestone.amount,
        milestone.description,
        milestone.obligation,
        milestone.is_completed
      ]
    );
    return result.rows[0];
  }

  async getMilestonesByChequeId(chequeId: string): Promise<Milestone[]> {
    const result = await this.pool.query(
      'SELECT * FROM milestones WHERE cheque_id = $1 ORDER BY milestone_index',
      [chequeId]
    );
    return result.rows;
  }

  async updateMilestoneCompletion(id: string, proof: string): Promise<Milestone> {
    const result = await this.pool.query(
      `UPDATE milestones 
       SET is_completed = true, proof = $2, completed_at = CURRENT_TIMESTAMP 
       WHERE id = $1 
       RETURNING *`,
      [id, proof]
    );
    return result.rows[0];
  }

  // Dispute operations
  async createDispute(dispute: Omit<Dispute, 'id' | 'created_at' | 'updated_at'>): Promise<Dispute> {
    const result = await this.pool.query(
      `INSERT INTO disputes (
        chain_id, dispute_id, cheque_id, milestone_id, initiator_address,
        reason, evidence, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        dispute.chain_id,
        dispute.dispute_id,
        dispute.cheque_id,
        dispute.milestone_id,
        dispute.initiator_address,
        dispute.reason,
        dispute.evidence,
        dispute.status
      ]
    );
    return result.rows[0];
  }

  async getDisputeById(id: string): Promise<Dispute | null> {
    const result = await this.pool.query(
      'SELECT * FROM disputes WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  async getDisputesByAddress(address: string): Promise<Dispute[]> {
    const result = await this.pool.query(
      `SELECT d.* FROM disputes d
       JOIN cheques c ON d.cheque_id = c.id
       WHERE c.buyer_address = $1 OR c.seller_address = $1
       ORDER BY d.created_at DESC`,
      [address]
    );
    return result.rows;
  }

  async updateDisputeResolution(
    id: string,
    arbitrator: string,
    resolutionType: number,
    resolutionAmount: string
  ): Promise<Dispute> {
    const result = await this.pool.query(
      `UPDATE disputes 
       SET arbitrator_address = $2,
           resolution_type = $3,
           resolution_amount = $4,
           status = 4,
           resolved_at = CURRENT_TIMESTAMP 
       WHERE id = $1 
       RETURNING *`,
      [id, arbitrator, resolutionType, resolutionAmount]
    );
    return result.rows[0];
  }

  // Oracle data operations
  async createOracleData(data: Omit<OracleData, 'id' | 'created_at' | 'updated_at'>): Promise<OracleData> {
    const result = await this.pool.query(
      `INSERT INTO oracle_data (
        obligation_hash, oracle_address, data_hash, reliability_score
      ) VALUES ($1, $2, $3, $4) RETURNING *`,
      [
        data.obligation_hash,
        data.oracle_address,
        data.data_hash,
        data.reliability_score
      ]
    );
    return result.rows[0];
  }

  async getOracleDataByHash(obligationHash: string): Promise<OracleData[]> {
    const result = await this.pool.query(
      'SELECT * FROM oracle_data WHERE obligation_hash = $1 ORDER BY reliability_score DESC',
      [obligationHash]
    );
    return result.rows;
  }

  // Event operations
  async createEvent(event: Omit<Event, 'id' | 'created_at'>): Promise<Event> {
    const result = await this.pool.query(
      `INSERT INTO events (
        chain_id, contract_address, event_name, transaction_hash,
        block_number, log_index, parameters
      ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        event.chain_id,
        event.contract_address,
        event.event_name,
        event.transaction_hash,
        event.block_number,
        event.log_index,
        event.parameters
      ]
    );
    return result.rows[0];
  }

  async getEventsByContract(contractAddress: string, fromBlock: number): Promise<Event[]> {
    const result = await this.pool.query(
      'SELECT * FROM events WHERE contract_address = $1 AND block_number >= $2 ORDER BY block_number, log_index',
      [contractAddress, fromBlock]
    );
    return result.rows;
  }
}

export const db = new DB();