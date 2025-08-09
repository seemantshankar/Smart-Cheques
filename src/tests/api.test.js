const request = require('supertest');
const { app } = require('../server');
const { db } = require('../db');

describe('API Endpoints', () => {
  beforeAll(async () => {
    // Setup test database or mock
    // Note: In a real implementation, you'd want to use a test database
  });

  afterAll(async () => {
    // Cleanup
    await db.end();
  });

  describe('Health Endpoints', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/healthz')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'ok');
    });

    it('should return readiness status', async () => {
      const response = await request(app)
        .get('/readyz')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'ready');
    });

    it('should return version info', async () => {
      const response = await request(app)
        .get('/version')
        .expect(200);
      
      expect(response.body).toHaveProperty('version');
    });
  });

  describe('Cheques API', () => {
    const testAddress = '0x1234567890123456789012345678901234567890';

    it('should get cheques for address', async () => {
      const response = await request(app)
        .get(`/api/cheques?address=${testAddress}`)
        .expect(200);
      
      expect(response.body).toHaveProperty('success');
      expect(response.body).toHaveProperty('cheques');
      expect(Array.isArray(response.body.cheques)).toBe(true);
    });

    it('should validate address parameter', async () => {
      const response = await request(app)
        .get('/api/cheques?address=invalid')
        .expect(400);
      
      expect(response.body).toHaveProperty('error');
    });

    it('should create a new cheque', async () => {
      const chequeData = {
        buyerAddress: testAddress,
        sellerAddress: '0x0987654321098765432109876543210987654321',
        totalAmount: '1000000000000000000', // 1 ETH in wei
        milestones: [
          {
            amount: '500000000000000000',
            description: 'First milestone',
            obligation: 'Complete initial work'
          },
          {
            amount: '500000000000000000',
            description: 'Second milestone',
            obligation: 'Complete final work'
          }
        ]
      };

      const response = await request(app)
        .post('/api/cheques')
        .send(chequeData)
        .expect(201);
      
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('chequeId');
    });

    it('should validate cheque creation data', async () => {
      const invalidData = {
        buyerAddress: 'invalid',
        sellerAddress: testAddress,
        totalAmount: 'not-a-number'
      };

      const response = await request(app)
        .post('/api/cheques')
        .send(invalidData)
        .expect(400);
      
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Disputes API', () => {
    const testAddress = '0x1234567890123456789012345678901234567890';

    it('should get disputes for address', async () => {
      const response = await request(app)
        .get(`/api/disputes?address=${testAddress}`)
        .expect(200);
      
      expect(response.body).toHaveProperty('success');
      expect(response.body).toHaveProperty('disputes');
      expect(Array.isArray(response.body.disputes)).toBe(true);
    });

    it('should validate address parameter for disputes', async () => {
      const response = await request(app)
        .get('/api/disputes?address=invalid')
        .expect(400);
      
      expect(response.body).toHaveProperty('error');
    });

    it('should create a new dispute', async () => {
      const disputeData = {
        chequeAddress: testAddress,
        milestoneId: 1,
        reason: 'Work not completed as specified',
        evidence: 'Screenshots and documentation showing incomplete work'
      };

      const response = await request(app)
        .post('/api/disputes')
        .send(disputeData)
        .expect(201);
      
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('disputeId');
    });

    it('should validate dispute creation data', async () => {
      const invalidData = {
        chequeAddress: 'invalid',
        milestoneId: 'not-a-number',
        reason: '',
        evidence: ''
      };

      const response = await request(app)
        .post('/api/disputes')
        .send(invalidData)
        .expect(400);
      
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Admin Endpoints', () => {
    describe('Relayer Admin', () => {
      it('should get relayer status', async () => {
        const response = await request(app)
          .get('/api/admin/relayer/status')
          .expect(200);
        
        expect(response.body).toHaveProperty('status');
      });

      it('should start relayer', async () => {
        const response = await request(app)
          .post('/api/admin/relayer/start')
          .expect(200);
        
        expect(response.body).toHaveProperty('success');
      });

      it('should stop relayer', async () => {
        const response = await request(app)
          .post('/api/admin/relayer/stop')
          .expect(200);
        
        expect(response.body).toHaveProperty('success');
      });

      it('should trigger relayer', async () => {
        const response = await request(app)
          .post('/api/admin/relayer/trigger')
          .expect(200);
        
        expect(response.body).toHaveProperty('success');
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle 404 for unknown endpoints', async () => {
      const response = await request(app)
        .get('/api/unknown-endpoint')
        .expect(404);
      
      expect(response.body).toHaveProperty('error');
    });

    it('should handle malformed JSON', async () => {
      const response = await request(app)
        .post('/api/cheques')
        .set('Content-Type', 'application/json')
        .send('{ invalid json }')
        .expect(400);
      
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Validation', () => {
    it('should validate Ethereum addresses', async () => {
      const invalidAddresses = [
        'invalid',
        '0x123',
        '0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG',
        ''
      ];

      for (const address of invalidAddresses) {
        const response = await request(app)
          .get(`/api/cheques?address=${address}`)
          .expect(400);
        
        expect(response.body).toHaveProperty('error');
      }
    });

    it('should validate numeric values', async () => {
      const invalidData = {
        buyerAddress: '0x1234567890123456789012345678901234567890',
        sellerAddress: '0x0987654321098765432109876543210987654321',
        totalAmount: 'not-a-number',
        milestones: []
      };

      const response = await request(app)
        .post('/api/cheques')
        .send(invalidData)
        .expect(400);
      
      expect(response.body).toHaveProperty('error');
    });
  });
});