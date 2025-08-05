# Smart Cheques Platform

A decentralized platform for creating and managing smart cheques with milestone-based payments and dispute resolution.

## Features

- Create smart cheques with multiple milestones
- Lock and release funds based on milestone completion
- Obligation verification through oracles
- Built-in dispute resolution system
- Web3 integration with multiple wallet support
- Modern React frontend with Chakra UI

## Project Structure

```
├── contracts/           # Smart contract source files
│   ├── SmartChequeFactory.sol
│   ├── SmartChequeEscrow.sol
│   ├── ObligationRegistry.sol
│   ├── DisputeManager.sol
│   └── test/
├── frontend/           # React frontend application
│   ├── src/
│   ├── public/
│   └── package.json
├── scripts/            # Deployment and test scripts
├── test/               # Contract test files
└── src/                # Backend API server
```

## Prerequisites

- Node.js >= 14.0.0
- npm >= 6.0.0
- Hardhat
- MetaMask or other Web3 wallet

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd smart-cheques
```

2. Install dependencies:
```bash
# Install contract dependencies
npm install

# Install frontend dependencies
cd frontend
npm install

# Install backend dependencies
cd ../src
npm install
```

3. Set up environment variables:
```bash
# Root directory
cp .env.example .env

# Frontend directory
cd frontend
cp .env.example .env
```

## Smart Contract Deployment

1. Configure your network in `hardhat.config.ts`

2. Deploy contracts:
```bash
npx hardhat run scripts/deploy.ts --network <network-name>
```

3. Update the contract addresses in both `.env` files

## Running the Application

1. Start the backend server:
```bash
cd src
npm run start
```

2. Start the frontend development server:
```bash
cd frontend
npm start
```

3. Access the application at `http://localhost:3000`

## Testing

Run the smart contract tests:
```bash
npx hardhat test
```

## Security Considerations

- All smart contracts are upgradeable using the UUPS pattern
- Access control implemented using OpenZeppelin's AccessControl
- Funds are held in escrow contracts
- Oracle data verification for obligations
- Dispute resolution system with arbitration

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.