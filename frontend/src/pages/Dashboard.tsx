import React, { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Heading,
  SimpleGrid,
  Text,
  Badge,
  Link,
  Stat,
  StatLabel,
  StatNumber,
  StatGroup,
  useColorModeValue,
  Skeleton
} from '@chakra-ui/react';
import { useWeb3React } from '@web3-react/core';
import { ethers } from 'ethers';

interface Cheque {
  id: string;
  address: string;
  buyer: string;
  seller: string;
  totalAmount: string;
  status: string;
}

const Dashboard = () => {
  const { account, library } = useWeb3React();
  const [cheques, setCheques] = useState<Cheque[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalCheques: 0,
    activeCheques: 0,
    totalValue: ethers.BigNumber.from(0)
  });

  const cardBg = useColorModeValue('white', 'gray.700');

  useEffect(() => {
    const fetchCheques = async () => {
      if (!account || !library) return;

      try {
        const response = await fetch(`${import.meta.env.VITE_API_URL}/cheques?address=${account}`);
        const data = await response.json();

        if (data.success) {
          setCheques(data.cheques);
          
          // Calculate stats
          const active = data.cheques.filter((c: Cheque) => c.status === '1').length;
          const totalValue = data.cheques.reduce(
            (acc: ethers.BigNumber, c: Cheque) => acc.add(ethers.BigNumber.from(c.totalAmount)),
            ethers.BigNumber.from(0)
          );

          setStats({
            totalCheques: data.cheques.length,
            activeCheques: active,
            totalValue
          });
        }
      } catch (error) {
        console.error('Error fetching cheques:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchCheques();
  }, [account, library]);

  const getStatusBadge = (status: string) => {
    const statusMap: { [key: string]: { color: string; label: string } } = {
      '0': { color: 'gray', label: 'Pending' },
      '1': { color: 'green', label: 'Active' },
      '2': { color: 'blue', label: 'Completed' },
      '3': { color: 'red', label: 'Disputed' },
      '4': { color: 'purple', label: 'Resolved' }
    };

    const { color, label } = statusMap[status] || { color: 'gray', label: 'Unknown' };
    return <Badge colorScheme={color}>{label}</Badge>;
  };

  if (!account) {
    return (
      <Box textAlign="center" py={10}>
        <Heading size="lg" mb={4}>
          Connect your wallet to view your Smart Cheques
        </Heading>
        <Text color="gray.500">
          You'll be able to see all your cheques and their current status here.
        </Text>
      </Box>
    );
  }

  return (
    <Box>
      <Heading mb={8}>Dashboard</Heading>

      <StatGroup
        bg={cardBg}
        p={6}
        borderRadius="lg"
        mb={8}
        boxShadow="sm"
      >
        <Stat>
          <StatLabel>Total Cheques</StatLabel>
          <StatNumber>{stats.totalCheques}</StatNumber>
        </Stat>

        <Stat>
          <StatLabel>Active Cheques</StatLabel>
          <StatNumber>{stats.activeCheques}</StatNumber>
        </Stat>

        <Stat>
          <StatLabel>Total Value</StatLabel>
          <StatNumber>
            {ethers.utils.formatEther(stats.totalValue)} ETH
          </StatNumber>
        </Stat>
      </StatGroup>

      <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={6}>
        {loading ? (
          Array(3).fill(0).map((_, i) => (
            <Skeleton key={i} height="200px" borderRadius="lg" />
          ))
        ) : cheques.length > 0 ? (
          cheques.map((cheque) => (
            <Box
              key={cheque.id}
              bg={cardBg}
              p={6}
              borderRadius="lg"
              boxShadow="sm"
            >
              <Link
                as={RouterLink}
                to={`/cheques/${cheque.id}`}
                _hover={{ textDecoration: 'none' }}
              >
                <Text fontWeight="bold" mb={2}>
                  Cheque #{cheque.id}
                </Text>
                <Text fontSize="sm" color="gray.500" mb={4}>
                  {cheque.address}
                </Text>

                <SimpleGrid columns={2} spacing={4} mb={4}>
                  <Box>
                    <Text fontSize="sm" color="gray.500">
                      Buyer
                    </Text>
                    <Text fontSize="sm" isTruncated>
                      {cheque.buyer}
                    </Text>
                  </Box>
                  <Box>
                    <Text fontSize="sm" color="gray.500">
                      Seller
                    </Text>
                    <Text fontSize="sm" isTruncated>
                      {cheque.seller}
                    </Text>
                  </Box>
                </SimpleGrid>

                <Text fontSize="sm" color="gray.500" mb={2}>
                  Amount
                </Text>
                <Text fontWeight="bold" mb={4}>
                  {ethers.utils.formatEther(cheque.totalAmount)} ETH
                </Text>

                {getStatusBadge(cheque.status)}
              </Link>
            </Box>
          ))
        ) : (
          <Box
            gridColumn="1/-1"
            textAlign="center"
            p={6}
            bg={cardBg}
            borderRadius="lg"
          >
            <Text>No cheques found. Create your first Smart Cheque!</Text>
          </Box>
        )}
      </SimpleGrid>
    </Box>
  );
};

export default Dashboard;