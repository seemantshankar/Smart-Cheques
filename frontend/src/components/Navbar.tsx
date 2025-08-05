import React, { useState, useEffect } from 'react';

// Type assertion helper for ethereum
const getEthereum = () => (window as any).ethereum;
import { Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Flex,
  Text,
  Button,
  Stack,
  Link,
  useColorModeValue,
  useDisclosure
} from '@chakra-ui/react';
import { useWeb3React } from '@web3-react/core';
import { metaMask, metaMaskHooks } from '../connectors';

const Navbar = () => {
  const { useChainId, useAccounts, useIsActivating, useIsActive, useProvider } = metaMaskHooks;
  const chainId = useChainId();
  const accounts = useAccounts();
  const account = accounts?.[0];
  const isActivating = useIsActivating();
  const active = useIsActive();
  const provider = useProvider();
  // Note: error property removed in Web3React v8
  const library = provider;
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [isMetaMaskInstalled, setIsMetaMaskInstalled] = useState(true);

  useEffect(() => {
    // Check if MetaMask is installed
    setIsMetaMaskInstalled(typeof window.ethereum !== 'undefined');
    
    if (!isMetaMaskInstalled) {
      console.warn('MetaMask is not installed');
      return;
    }
    
    // Clean up any old event listeners
    return () => {
      const ethereum = getEthereum();
      if (ethereum && ethereum.removeAllListeners) {
        try {
          ethereum.removeAllListeners('disconnect');
          ethereum.removeAllListeners('chainChanged');
          ethereum.removeAllListeners('accountsChanged');
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    };
  }, [isMetaMaskInstalled]);

  useEffect(() => {
    console.log('Wallet state:', {
      active,
      account,
      chainId
    });
    
    // Check if chain ID matches expected chain
    if (active && chainId) {
      const expectedChainId = Number(import.meta.env.VITE_CHAIN_ID || '31337');
      if (chainId !== expectedChainId) {
        console.warn(`Connected to wrong chain. Expected: ${expectedChainId}, Got: ${chainId}`);
      }
    }
  }, [active, account, chainId]);

  type Currency = {
  name: string;
  symbol: string;
  decimals: number;
};

async function ensureChain(params: {
  ethereum: any;
  chainIdHex: "0x7a69" | "0x539";
  chainName?: string;
  rpcUrl?: string;
  blockExplorerUrl?: string;
  currency?: Currency;
}) {
  const {
    ethereum,
    chainIdHex,
    chainName = chainIdHex === "0x7a69"
      ? "Hardhat 31337"
      : "Localhost 1337",
    rpcUrl = "http://127.0.0.1:8545",
    blockExplorerUrl,
    currency = { name: "Ether", symbol: "ETH", decimals: 18 },
  } = params;

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
  } catch (err: any) {
    if (err?.code === 4902) {
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: chainIdHex,
            chainName,
            nativeCurrency: currency,
            rpcUrls: [rpcUrl],
            blockExplorerUrls: blockExplorerUrl ? [blockExplorerUrl] : [],
          },
        ],
      });
      await ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainIdHex }],
      });
    } else {
      throw err;
    }
  }
}

async function detectLocalChainIdHex(): Promise<"0x7a69" | "0x539"> {
  try {
    const res = await fetch("http://127.0.0.1:8545", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_chainId",
        params: [],
      }),
    });
    const json = await res.json();
    const id = (json?.result || "").toLowerCase();
    if (id === "0x7a69" || id === "0x539") return id;
  } catch (error) {
    console.error("Failed to detect chain ID:", error);
  }
  return "0x7a69";
}

const connectWallet = async () => {
  console.log('Attempting to connect wallet...');
  
  if (!isMetaMaskInstalled) {
    alert('MetaMask is not installed. Please install MetaMask to connect your wallet.');
    window.open('https://metamask.io/download/', '_blank');
    return;
  }
  
  try {
    // Option A: Hardcode to what you run locally
    // const chainIdHex: "0x7a69" | "0x539" = "0x7a69"; // or "0x539"
    
    // Option B: Detect from node
    const chainIdHex = await detectLocalChainIdHex();
    
    const ethereum = getEthereum();
     await ensureChain({
       ethereum,
       chainIdHex,
       rpcUrl: import.meta.env.VITE_RPC_URL,
     });
       
       await metaMask.activate();
       console.log('Wallet connection activated');
       
       // Set up EIP-1193 compliant event listeners
       if (ethereum && ethereum.on) {
        ethereum.on('disconnect', () => {
          console.log('MetaMask disconnected');
          if (metaMask.deactivate) {
            metaMask.deactivate();
          }
        });
        
        ethereum.on('chainChanged', (chainId: string) => {
          console.log('Chain changed:', chainId);
          window.location.reload();
        });
        
        ethereum.on('accountsChanged', (accounts: string[]) => {
          console.log('Accounts changed:', accounts);
          if (accounts.length === 0) {
            if (metaMask.deactivate) {
              metaMask.deactivate();
            }
          } else {
            window.location.reload();
          }
        });
      }
    } catch (error: any) {
      console.error('Error connecting wallet:', error);
      
      // Handle chain not added error
      if (error.code === 4902) {
        try {
          const expectedChainId = Number(import.meta.env.VITE_CHAIN_ID || '1337');
          await getEthereum()?.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: `0x${expectedChainId.toString(16)}`,
              chainName: 'Hardhat Localhost',
              nativeCurrency: {
                name: 'Ether',
                symbol: 'ETH',
                decimals: 18
              },
              rpcUrls: [import.meta.env.VITE_RPC_URL || 'http://localhost:8545'],
              blockExplorerUrls: ['https://etherscan.io']
            }]
          });
          await metaMask.activate();
        } catch (addError: any) {
          alert(`Failed to add network and connect wallet: ${addError?.message || 'Unknown error'}`);
        }
      } else {
        alert(`Failed to connect wallet: ${(error as any)?.message || 'Unknown error'}`);
      }
    }
  };

  const disconnectWallet = async () => {
    console.log('Attempting to disconnect wallet...');
    try {
      if (metaMask.deactivate) {
        await metaMask.deactivate();
      }
      console.log('Wallet disconnected');
    } catch (error) {
      console.error('Error disconnecting wallet:', error);
    }
  };

  return (
    <Box
      bg={useColorModeValue('white', 'gray.800')}
      px={4}
      boxShadow={'sm'}
    >
      <Flex
        h={16}
        alignItems={'center'}
        justifyContent={'space-between'}
        maxW={'container.xl'}
        mx={'auto'}
      >
        <Text
          fontSize={'xl'}
          fontWeight={'bold'}
          as={RouterLink}
          to={'/'}
        >
          Smart Cheques
        </Text>

        <Flex alignItems={'center'}>
          <Stack direction={'row'} spacing={4}>
            <Link
              as={RouterLink}
              to={'/'}
              px={2}
              py={1}
              rounded={'md'}
              _hover={{
                textDecoration: 'none',
                bg: useColorModeValue('gray.100', 'gray.700'),
              }}
            >
              Dashboard
            </Link>
            <Link
              as={RouterLink}
              to={'/create'}
              px={2}
              py={1}
              rounded={'md'}
              _hover={{
                textDecoration: 'none',
                bg: useColorModeValue('gray.100', 'gray.700'),
              }}
            >
              Create Cheque
            </Link>
            <Link
              as={RouterLink}
              to={'/disputes'}
              px={2}
              py={1}
              rounded={'md'}
              _hover={{
                textDecoration: 'none',
                bg: useColorModeValue('gray.100', 'gray.700'),
              }}
            >
              Disputes
            </Link>

            {!isMetaMaskInstalled ? (
              <Box>
                <Text color="red.500" fontSize="xs" mb={1}>
                  MetaMask not installed
                </Text>
                <Button
                  onClick={() => window.open('https://metamask.io/download/', '_blank')}
                  size={'sm'}
                  colorScheme={'orange'}
                >
                  Install MetaMask
                </Button>
              </Box>
            ) : active ? (
              <Box>
                {chainId && chainId !== Number(import.meta.env.VITE_CHAIN_ID || '1337') ? (
                  <Text color="orange.500" fontSize="xs" mb={1}>
                    ⚠️ Wrong network! Switch to Localhost
                  </Text>
                ) : (
                  <Text fontSize="xs" color="gray.500" mb={1}>
                    Connected: {chainId === 31337 ? 'Localhost' : `Chain ${chainId}`}
                  </Text>
                )}
                <Button
                  onClick={disconnectWallet}
                  size={'sm'}
                  colorScheme={'red'}
                >
                  {`${account?.slice(0, 6)}...${account?.slice(-4)}`}
                </Button>
              </Box>
            ) : (
              <Button
                onClick={connectWallet}
                size={'sm'}
                colorScheme={'blue'}
              >
                Connect Wallet
              </Button>
            )}
          </Stack>
        </Flex>
      </Flex>
    </Box>
  );
};

export default Navbar;