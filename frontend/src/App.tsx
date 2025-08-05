import React, { useMemo } from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { Box } from '@chakra-ui/react';
import { Web3ReactProvider } from '@web3-react/core';
import { metaMask, metaMaskHooks } from './connectors';
import type { Connector } from '@web3-react/types';
import type { Web3ReactHooks } from '@web3-react/core';

// Components
import Navbar from './components/Navbar';
import Dashboard from './pages/Dashboard';
import CreateCheque from './pages/CreateCheque';
import ChequeDetails from './pages/ChequeDetails';
import DisputeManager from './pages/DisputeManager';

function App() {
  const connectors: [Connector, Web3ReactHooks][] = useMemo(() => [[metaMask, metaMaskHooks]], []);
  return (
    <Web3ReactProvider connectors={connectors} lookupENS={false}>
      <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Box minH="100vh" bg="gray.50">
          <Navbar />
          <Box maxW="container.xl" mx="auto" px={4} py={8}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/create" element={<CreateCheque />} />
              <Route path="/cheques/:id" element={<ChequeDetails />} />
              <Route path="/disputes" element={<DisputeManager />} />
            </Routes>
          </Box>
        </Box>
      </Router>
    </Web3ReactProvider>
  );
}

export default App;