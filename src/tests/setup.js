const dotenv = require('dotenv');

// Load test environment variables
dotenv.config({ path: '.env.test' });

// Set test environment variables if not already set
process.env.NODE_ENV = 'test';
process.env.RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
process.env.PRIVATE_KEY = process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
process.env.FACTORY_ADDRESS = process.env.FACTORY_ADDRESS || '0x5FbDB2315678afecb367f032d93F642f64180aa3';
process.env.OBLIGATION_REGISTRY_ADDRESS = process.env.OBLIGATION_REGISTRY_ADDRESS || '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
process.env.DISPUTE_MANAGER_ADDRESS = process.env.DISPUTE_MANAGER_ADDRESS || '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';
process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.DB_PORT || '5432';
process.env.DB_NAME = process.env.DB_NAME || 'smart_cheques_test';
process.env.DB_USER = process.env.DB_USER || 'postgres';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'postgres';

// Mock database for tests
jest.mock('../db', () => ({
  db: {
    query: jest.fn(),
    end: jest.fn(),
  },
}));

// Global test timeout
jest.setTimeout(30000);