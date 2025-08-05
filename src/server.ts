import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { ethers } from 'ethers';
import dotenv from 'dotenv';
import { body, validationResult } from 'express-validator';

// Load environment variables
dotenv.config();

// Initialize express app
const app = express();

// Middleware
app.use(cors());
app.use(helmet());
app.use(morgan('combined'));
app.use(express.json());

// Initialize provider and contracts
const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

// Load contract ABIs
const SmartChequeFactory = require('../artifacts/contracts/SmartChequeFactory.sol/SmartChequeFactory.json');
const SmartChequeEscrow = require('../artifacts/contracts/SmartChequeEscrow.sol/SmartChequeEscrow.json');
const ObligationRegistry = require('../artifacts/contracts/ObligationRegistry.sol/ObligationRegistry.json');
const DisputeManager = require('../artifacts/contracts/DisputeManager.sol/DisputeManager.json');

// Initialize contract instances
const factoryContract = new ethers.Contract(
  process.env.FACTORY_ADDRESS!,
  SmartChequeFactory.abi,
  wallet
);

const obligationRegistry = new ethers.Contract(
  process.env.OBLIGATION_REGISTRY_ADDRESS!,
  ObligationRegistry.abi,
  wallet
);

const disputeManager = new ethers.Contract(
  process.env.DISPUTE_MANAGER_ADDRESS!,
  DisputeManager.abi,
  wallet
);

// Validation middleware
const createChequeValidation = [
  body('buyer').isEthereumAddress(),
  body('seller').isEthereumAddress(),
  body('totalAmount').isString(),
  body('milestones').isArray(),
  body('obligations').isArray()
];

// Error handling middleware
const handleValidationErrors = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Routes
app.get('/api/cheques', async (req, res) => {
  try {
    const { address } = req.query;
    
    if (!address) {
      return res.status(400).json({
        success: false,
        error: 'Address parameter is required'
      });
    }

    // For now, return empty array since database integration is not fully implemented
    // In a full implementation, you would query cheques by address from the blockchain or database
    const cheques: any[] = [];
    
    res.status(200).json({ 
      success: true, 
      cheques 
    });
  } catch (error) {
    console.error('Error fetching cheques:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch cheques'
    });
  }
});

app.post('/api/cheques', createChequeValidation, handleValidationErrors, async (req: Request, res: Response) => {
  try {
    const { buyer, seller, totalAmount, milestones, obligations } = req.body;

    const tx = await factoryContract.createCheque(
      buyer,
      seller,
      totalAmount,
      milestones,
      obligations
    );

    const receipt = await tx.wait();
    const event = receipt.events?.find((e: any) => e.event === 'ChequeCreated');
    const chequeId = event?.args?.chequeId;

    res.json({
      success: true,
      chequeId,
      transactionHash: tx.hash
    });
  } catch (error) {
    console.error('Error creating cheque:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create cheque'
    });
  }
});

app.get('/api/cheques/:chequeId', async (req, res) => {
  try {
    const chequeId = req.params.chequeId;
    const chequeAddress = await factoryContract.getChequeAddress(chequeId);
    
    if (chequeAddress === ethers.constants.AddressZero) {
      return res.status(404).json({
        success: false,
        error: 'Cheque not found'
      });
    }

    const chequeContract = new ethers.Contract(
      chequeAddress,
      SmartChequeEscrow.abi,
      wallet
    );

    const [buyer, seller, totalAmount, status] = await Promise.all([
      chequeContract.buyer(),
      chequeContract.seller(),
      chequeContract.totalAmount(),
      chequeContract.status()
    ]);

    res.json({
      success: true,
      cheque: {
        id: chequeId,
        address: chequeAddress,
        buyer,
        seller,
        totalAmount: totalAmount.toString(),
        status: status.toString()
      }
    });
  } catch (error) {
    console.error('Error fetching cheque:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch cheque'
    });
  }
});

app.post('/api/cheques/:chequeId/milestones/:milestoneId/complete', async (req, res) => {
  try {
    const { chequeId, milestoneId } = req.params;
    const { proof } = req.body;

    const chequeAddress = await factoryContract.getChequeAddress(chequeId);
    const chequeContract = new ethers.Contract(
      chequeAddress,
      SmartChequeEscrow.abi,
      wallet
    );

    const tx = await chequeContract.completeMilestone(
      milestoneId,
      proof
    );

    await tx.wait();

    res.json({
      success: true,
      transactionHash: tx.hash
    });
  } catch (error) {
    console.error('Error completing milestone:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to complete milestone'
    });
  }
});

app.get('/api/disputes', async (req, res) => {
  try {
    const address = req.query.address as string;
    
    if (!address) {
      return res.status(400).json({
        success: false,
        error: 'Address parameter is required'
      });
    }

    // For now, return empty array since database integration is not fully implemented
    // In a full implementation, you would use: await db.getDisputesByAddress(address)
    const disputes: any[] = [];
    
    res.status(200).json({ 
      success: true, 
      disputes 
    });
  } catch (error) {
    console.error('Error fetching disputes:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch disputes'
    });
  }
});

app.post('/api/disputes', async (req, res) => {
  try {
    const { chequeAddress, milestoneId, reason, evidence } = req.body;

    const tx = await disputeManager.openDispute(
      chequeAddress,
      milestoneId,
      reason,
      evidence
    );

    const receipt = await tx.wait();
    const event = receipt.events?.find((e: any) => e.event === 'DisputeOpened');
    const disputeId = event?.args?.disputeId;

    res.json({
      success: true,
      disputeId,
      transactionHash: tx.hash
    });
  } catch (error) {
    console.error('Error opening dispute:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to open dispute'
    });
  }
});

app.get('/api/disputes/:disputeId', async (req, res) => {
  try {
    const { disputeId } = req.params;
    const dispute = await disputeManager.getDispute(disputeId);

    res.json({
      success: true,
      dispute: {
        id: disputeId,
        chequeAddress: dispute.chequeAddress,
        milestoneId: dispute.milestoneId.toString(),
        status: dispute.status.toString(),
        arbitrator: dispute.arbitrator
      }
    });
  } catch (error) {
    console.error('Error fetching dispute:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dispute'
    });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});