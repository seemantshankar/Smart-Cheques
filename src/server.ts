import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import winston from 'winston';
import { ethers, JsonRpcProvider, ZeroAddress, id } from 'ethers';
import dotenv from 'dotenv';
import { body, query, validationResult } from 'express-validator';
import { db } from './db';
import { EventListener } from './services/EventListener';
import { OracleService } from './services/OracleService';
import { RelayerService } from './services/RelayerService';

// Load environment variables
dotenv.config();

// Initialize express app
const app = express();

// Middleware
app.use(cors());
app.use(helmet());
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  transports: [new winston.transports.Console()],
  format: winston.format.json()
});
app.use(morgan('combined'));
app.use(express.json());

// Initialize provider and contracts
const provider = new JsonRpcProvider(process.env.RPC_URL);
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

const disputesOpenValidation = [
  body('chequeAddress').isEthereumAddress(),
  body('milestoneId').isInt({ min: 0 }).toInt(),
  body('reason').isString().isLength({ min: 1 }),
  body('evidence').isString().optional()
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
app.get('/api/cheques', [query('address').isEthereumAddress()], handleValidationErrors, async (req, res) => {
  try {
    const address = req.query.address as string | undefined;

    if (!address) {
      return res.status(400).json({ success: false, error: 'Address parameter is required' });
    }

    const rows = await db.getChequesByAddress(address);

    // Map DB rows to API shape; augment from chain if missing
    const results = await Promise.all(
      rows.map(async (row) => {
        let totalAmount = row.total_amount?.toString?.() ?? String(row.total_amount);
        let status = row.status?.toString?.() ?? String(row.status);

        // Fallback to on-chain if not available or zero
        if (!totalAmount || totalAmount === '0' || totalAmount === '0.0') {
          try {
            const chequeContract = new ethers.Contract(row.contract_address, SmartChequeEscrow.abi, wallet);
            const [onChainTotal, onChainStatus] = await Promise.all([
              chequeContract.totalAmount(),
              chequeContract.status()
            ]);
            totalAmount = onChainTotal.toString();
            status = onChainStatus.toString();
          } catch (e) {
            // Best-effort; keep DB values if on-chain fetch fails
          }
        }

        return {
          id: row.cheque_id, // expose on-chain cheque id to the client
          address: chequeContract.target,
          buyer: row.buyer_address,
          seller: row.seller_address,
          totalAmount,
          status
        };
      })
    );

    res.status(200).json({ success: true, cheques: results });
  } catch (error) {
    console.error('Error fetching cheques:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch cheques' });
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
    
    if (chequeAddress === ZeroAddress) {
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

    // Fetch milestones metadata from DB if present
    let milestones: any[] = [];
    try {
      // We infer current chainId via provider
      const network = await provider.getNetwork();
      const chainId = network.chainId;
      const chequeRow = await db.getChequeByChainAndChequeId(chainId, chequeId);
      if (chequeRow) {
        const milestoneRows = await db.getMilestonesByChequeId(chequeRow.id);
        milestones = await Promise.all(
          milestoneRows.map(async (m) => {
            // Optionally enrich completion from on-chain state
            let isCompleted = m.is_completed;
            let isDisputed = false;
            try {
              const onChain = await chequeContract.getMilestone(m.milestone_index);
              isCompleted = Boolean(onChain[2]);
              isDisputed = Boolean(onChain[3]);
            } catch (_) {}

            // Determine verification status from oracle data by obligation hash (computed from text)
            let verification: 'pending' | 'verified' = 'pending';
            try {
              const obligationHash = id(m.obligation);
              const oracleData = await db.getOracleDataByHash(obligationHash);
              if (oracleData && oracleData.length > 0) {
                verification = 'verified';
              }
            } catch (_) {}

            return {
              amount: m.amount?.toString?.() ?? String(m.amount),
              description: m.description,
              obligation: m.obligation,
              isCompleted,
              isDisputed,
              proof: m.proof || undefined,
              verification
            };
          })
        );
      }
    } catch (_) {
      // best-effort, ignore DB errors for this route
    }

    res.json({
      success: true,
      cheque: {
        id: chequeId,
        address: chequeAddress,
        buyer,
        seller,
        totalAmount: totalAmount.toString(),
        status: status.toString(),
        milestones
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

// BE-02: Persist milestones metadata submitted by frontend after cheque creation
app.post('/api/cheques/:chequeId/metadata',
  [
    body('milestones').isArray({ min: 1 }),
    body('milestones.*.description').isString().isLength({ min: 1 }),
    body('milestones.*.obligation').isString().isLength({ min: 1 })
  ],
  handleValidationErrors,
  async (req: Request, res: Response) => {
    try {
      const { chequeId } = req.params;
      const { milestones } = req.body as { milestones: Array<{ description: string; obligation: string }> };

      const network = await provider.getNetwork();
      const chainId = network.chainId;

      // Resolve on-chain cheque address and participants
      const chequeAddress = await factoryContract.getChequeAddress(chequeId);
      if (chequeAddress === ethers.constants.AddressZero) {
        return res.status(404).json({ success: false, error: 'Cheque not found' });
      }

      const chequeContract = new ethers.Contract(chequeAddress, SmartChequeEscrow.abi, wallet);
      const [buyer, seller, totalAmount, milestoneCount] = await Promise.all([
        chequeContract.buyer(),
        chequeContract.seller(),
        chequeContract.totalAmount(),
        chequeContract.getMilestoneCount()
      ]);

      // Upsert cheque in DB if missing
      let chequeRow = await db.getChequeByChainAndChequeId(chainId, chequeId);
      if (!chequeRow) {
        chequeRow = await db.createCheque({
          chain_id: chainId,
          cheque_id: chequeId,
          contract_address: chequeAddress,
          buyer_address: buyer,
          seller_address: seller,
          total_amount: totalAmount.toString(),
          status: 0
        });
      }

      // Insert milestones metadata
      const toIndex = Number(milestoneCount);
      const creations = [] as Promise<any>[];
      for (let i = 0; i < toIndex && i < milestones.length; i++) {
        const onChainMilestone = await chequeContract.getMilestone(i);
        const amount = onChainMilestone[0].toString();
        const description = milestones[i].description;
        const obligation = milestones[i].obligation;

        // Skip if already exists
        const existing = await db.getMilestoneByChequeAndIndex(chequeRow.id, i);
        if (!existing) {
          creations.push(
            db.createMilestone({
              cheque_id: chequeRow.id,
              milestone_index: i,
              amount,
              description,
              obligation,
              is_completed: false
            })
          );
        }
      }
      await Promise.all(creations);

      res.status(201).json({ success: true });
    } catch (error) {
      console.error('Error saving cheque metadata:', error);
      res.status(500).json({ success: false, error: 'Failed to save cheque metadata' });
    }
  }
);

app.get('/api/disputes', [query('address').isEthereumAddress()], handleValidationErrors, async (req, res) => {
  try {
    const address = req.query.address as string | undefined;
    const statusFilter = req.query.status as string | undefined; // optional
    const page = parseInt((req.query.page as string) || '1', 10);
    const pageSize = Math.min(parseInt((req.query.pageSize as string) || '25', 10), 100);

    if (!address) {
      return res.status(400).json({ success: false, error: 'Address parameter is required' });
    }

    const rows = await db.getDisputesByAddress(address);

    // Optional status filtering
    const filtered = typeof statusFilter !== 'undefined'
      ? rows.filter((r: any) => String(r.status) === String(statusFilter))
      : rows;

    // Pagination
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const paged = filtered.slice(start, end);

    const disputes = paged.map((row: any) => ({
      id: row.dispute_id, // expose on-chain id
      chequeAddress: row.cheque_contract_address ?? row.cheque_id, // fallback if schema is different
      milestoneId: String(row.milestone_id),
      status: String(row.status),
      reason: row.reason,
      evidence: row.evidence,
      arbitrator: row.arbitrator_address || ZeroAddress
    }));

    res.status(200).json({ success: true, total, page, pageSize, disputes });
  } catch (error) {
    console.error('Error fetching disputes:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch disputes' });
  }
});

app.post('/api/disputes', disputesOpenValidation, handleValidationErrors, async (req, res) => {
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
  logger.info(`Server running on port ${PORT}`);
  // Initialize event listener in background
  try {
    const listener = new EventListener(process.env.RPC_URL!);
    listener.initialize()
      .then(() => logger.info('EventListener initialized'))
      .catch((e) => logger.error('EventListener init error', e));

    // Start periodic oracle verification job (dummy cadence)
    const oracleService = new OracleService(process.env.RPC_URL!, process.env.PRIVATE_KEY!);
    setInterval(async () => {
      try {
        const obligations = await db.getDistinctObligations();
        for (const row of obligations) {
          await oracleService.verifyObligation(row.obligation_hash);
        }
      } catch (e) {
        logger.error('Oracle verification sweep error', e as Error);
      }
    }, parseInt(process.env.ORACLE_SWEEP_INTERVAL_MS || '60000', 10));

    // Optionally initialize RelayerService controls
    relayerService = maybeCreateRelayerService();
  } catch (e) {
    logger.error('Background services init error', e as Error);
  }
});

// Health and version endpoints
app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});
app.get('/readyz', (_req, res) => {
  const ready = Boolean(process.env.RPC_URL && process.env.FACTORY_ADDRESS);
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready' });
});
app.get('/version', (_req, res) => {
  res.json({ version: process.env.APP_VERSION || 'dev' });
});

// Relayer admin endpoints (optional)
let relayerService: RelayerService | null = null;
function maybeCreateRelayerService(): RelayerService | null {
  try {
    const required = [
      'L1_BRIDGE_ADDRESS',
      'L2_BRIDGE_ADDRESS',
      'NATIVE_BRIDGE_ADDRESS',
      'L1_RPC_URL',
      'L2_RPC_URL',
      'VALIDATOR_PRIVATE_KEY',
      'RELAYER_PRIVATE_KEY'
    ];
    for (const key of required) {
      if (!process.env[key]) return null;
    }
    const l1Provider = new JsonRpcProvider(process.env.L1_RPC_URL!);
    const l2Provider = new JsonRpcProvider(process.env.L2_RPC_URL!);
    return new RelayerService({
      l1Provider,
      l2Provider,
      l1BridgeAddress: process.env.L1_BRIDGE_ADDRESS!,
      l2BridgeAddress: process.env.L2_BRIDGE_ADDRESS!,
      nativeBridgeAddress: process.env.NATIVE_BRIDGE_ADDRESS!,
      validatorPrivateKey: process.env.VALIDATOR_PRIVATE_KEY!,
      relayerPrivateKey: process.env.RELAYER_PRIVATE_KEY!,
      merkleUpdateInterval: parseInt(process.env.MERKLE_UPDATE_INTERVAL_MS || '60000', 10),
      challengePeriod: parseInt(process.env.BRIDGE_CHALLENGE_PERIOD_SEC || '604800', 10),
      gasLimit: parseInt(process.env.RELAYER_GAS_LIMIT || '3000000', 10),
      gasPrice: process.env.RELAYER_GAS_PRICE_GWEI || '10'
    });
  } catch (e) {
    console.error('RelayerService init error', e);
    return null;
  }
}

app.get('/api/admin/relayer/status', (_req, res) => {
  if (!relayerService) return res.status(200).json({ enabled: false });
  return res.json({ enabled: true, status: relayerService.getStatus() });
});
app.post('/api/admin/relayer/start', async (_req, res) => {
  try {
    if (!relayerService) {
      relayerService = maybeCreateRelayerService();
    }
    if (!relayerService) return res.status(400).json({ success: false, error: 'Relayer not configured' });
    await relayerService.start();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to start relayer' });
  }
});
app.post('/api/admin/relayer/stop', async (_req, res) => {
  try {
    if (!relayerService) return res.json({ success: true });
    await relayerService.stop();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to stop relayer' });
  }
});
app.post('/api/admin/relayer/trigger', async (_req, res) => {
  try {
    if (!relayerService) return res.status(400).json({ success: false, error: 'Relayer not configured' });
    await relayerService.triggerMerkleUpdate();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to trigger update' });
  }
});