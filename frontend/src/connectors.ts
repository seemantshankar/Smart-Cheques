import { initializeConnector } from '@web3-react/core';
import { MetaMask } from '@web3-react/metamask';

const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID || '31337');

// Initialize MetaMask connector with proper v8 syntax
export const [metaMask, hooks] = initializeConnector<MetaMask>(
  (actions) => new MetaMask({ actions })
);

// For backward compatibility, export as injected
export const injected = metaMask;
export const metaMaskHooks = hooks;