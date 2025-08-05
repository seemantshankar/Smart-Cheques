import React, { useEffect, useState } from 'react';
import {
  Box,
  VStack,
  Heading,
  Text,
  Button,
  Badge,
  useToast,
  SimpleGrid,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
  Textarea,
  FormControl,
  FormLabel,
  Select,
  Skeleton
} from '@chakra-ui/react';
import { useWeb3React } from '@web3-react/core';
import { ethers } from 'ethers';

interface Dispute {
  id: string;
  chequeAddress: string;
  milestoneId: string;
  status: string;
  reason: string;
  evidence: string;
  arbitrator: string;
  resolution?: {
    type: string;
    amount: string;
  };
}

const DisputeManager = () => {
  const { account, provider } = useWeb3React();
  const toast = useToast();
  const { isOpen, onOpen, onClose } = useDisclosure();

  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDispute, setSelectedDispute] = useState<Dispute | null>(null);
  const [resolution, setResolution] = useState({
    type: '1', // Default to ReleaseFunds
    amount: '0'
  });
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (!account || !provider) return;
    setLoading(true);
    fetchDisputes();
  }, [account, provider]);

  const fetchDisputes = async () => {
    if (!account || !provider) return;

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/disputes?address=${account}`);

      // If the API returns a non-OK status, only show an error toast for real failures (not empty states)
      if (!response.ok) {
        // Attempt to parse error body to detect an empty/no disputes condition gracefully
        try {
          const errBody = await response.json();
          // If backend indicates success false but zero disputes or a known empty state, handle gracefully
          if ((errBody && Array.isArray(errBody.disputes) && errBody.disputes.length === 0) || errBody?.code === 'NO_DISPUTES') {
            setDisputes([]);
            return;
          }
        } catch (_) {
          // ignore JSON parse error and treat as real error below
        }
        throw new Error(`Failed to load disputes (${response.status})`);
      }

      const data = await response.json();

      // Treat success with empty array as a valid empty state
      if (data?.success) {
        setDisputes(Array.isArray(data.disputes) ? data.disputes : []);
      } else if (Array.isArray(data?.disputes)) {
        // Some backends may not include a success flag
        setDisputes(data.disputes);
      } else {
        // If response shape is unexpected, default to empty state instead of error toast
        setDisputes([]);
      }
    } catch (error) {
      console.error('Error fetching disputes:', error);
      // Only show a toast when this is a genuine failure (e.g., network down) and not just no disputes
      toast({
        title: 'Error',
        description: 'Failed to load disputes',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleResolveDispute = async () => {
    if (!selectedDispute || !provider || !account) return;

    try {
      setResolving(true);

      const disputeManagerContract = new ethers.Contract(
        import.meta.env.VITE_DISPUTE_MANAGER_ADDRESS!,
        [
          'function proposeResolution(uint256,uint8,uint256) returns (bool)',
          'function resolveDispute(uint256) returns (bool)'
        ],
        provider.getSigner()
      );

      // First propose resolution
      const proposeTx = await disputeManagerContract.proposeResolution(
        selectedDispute.id,
        parseInt(resolution.type),
        ethers.utils.parseEther(resolution.amount)
      );

      await proposeTx.wait();

      // Then resolve the dispute
      const resolveTx = await disputeManagerContract.resolveDispute(selectedDispute.id);
      await resolveTx.wait();

      toast({
        title: 'Success',
        description: 'Dispute resolved successfully',
        status: 'success',
        duration: 5000,
        isClosable: true,
      });

      onClose();
      fetchDisputes();
    } catch (error: any) {
      console.error('Error resolving dispute:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to resolve dispute',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setResolving(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusMap: { [key: string]: { color: string; label: string } } = {
      '0': { color: 'yellow', label: 'Opened' },
      '1': { color: 'blue', label: 'Under Review' },
      '2': { color: 'orange', label: 'Resolution Proposed' },
      '3': { color: 'red', label: 'Rejected' },
      '4': { color: 'green', label: 'Resolved' },
      '5': { color: 'purple', label: 'Escalated' }
    };

    const { color, label } = statusMap[status] || { color: 'gray', label: 'Unknown' };
    return <Badge colorScheme={color}>{label}</Badge>;
  };

  const openResolveModal = (dispute: Dispute) => {
    setSelectedDispute(dispute);
    setResolution({ type: '1', amount: '0' });
    onOpen();
  };

  if (!account) {
    return (
      <Box textAlign="center" py={10}>
        <Heading size="lg" mb={4}>
          Connect your wallet to view disputes
        </Heading>
        <Text color="gray.500">
          You'll be able to see and manage disputes once your wallet is connected.
        </Text>
      </Box>
    );
  }

  if (loading) {
    return (
      <VStack spacing={8}>
        <Skeleton height="40px" width="200px" />
        <SimpleGrid columns={{ base: 1, md: 2 }} spacing={6} width="100%">
          {Array(4).fill(0).map((_, i) => (
            <Skeleton key={i} height="200px" />
          ))}
        </SimpleGrid>
      </VStack>
    );
  }

  return (
    <Box>
      <Heading mb={8}>Dispute Manager</Heading>

      {disputes.length > 0 ? (
        <SimpleGrid columns={{ base: 1, md: 2 }} spacing={6}>
          {disputes.map((dispute) => (
            <Box
              key={dispute.id}
              p={6}
              borderWidth={1}
              borderRadius="lg"
              boxShadow="sm"
            >
              <VStack align="stretch" spacing={4}>
                <Box>
                  <Text color="gray.500" fontSize="sm">
                    Dispute ID
                  </Text>
                  <Text fontWeight="bold">
                    #{dispute.id}
                  </Text>
                </Box>

                <Box>
                  <Text color="gray.500" fontSize="sm">
                    Cheque Address
                  </Text>
                  <Text fontSize="sm" wordBreak="break-all">
                    {dispute.chequeAddress}
                  </Text>
                </Box>

                <Box>
                  <Text color="gray.500" fontSize="sm">
                    Milestone ID
                  </Text>
                  <Text>
                    #{dispute.milestoneId}
                  </Text>
                </Box>

                <Box>
                  <Text color="gray.500" fontSize="sm">
                    Reason
                  </Text>
                  <Text fontSize="sm">
                    {dispute.reason}
                  </Text>
                </Box>

                <Box>
                  <Text color="gray.500" fontSize="sm">
                    Status
                  </Text>
                  {getStatusBadge(dispute.status)}
                </Box>

                {dispute.arbitrator === account && dispute.status !== '4' && (
                  <Button
                    colorScheme="blue"
                    onClick={() => openResolveModal(dispute)}
                  >
                    Resolve Dispute
                  </Button>
                )}
              </VStack>
            </Box>
          ))}
        </SimpleGrid>
      ) : (
        <Box textAlign="center" py={10}>
          <Text>No disputes found.</Text>
        </Box>
      )}

      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Resolve Dispute</ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <FormControl>
                <FormLabel>Resolution Type</FormLabel>
                <Select
                  value={resolution.type}
                  onChange={(e) => setResolution({ ...resolution, type: e.target.value })}
                >
                  <option value="1">Release Funds</option>
                  <option value="2">Refund</option>
                  <option value="3">Split</option>
                </Select>
              </FormControl>

              <FormControl>
                <FormLabel>Amount (ETH)</FormLabel>
                <input
                  type="number"
                  value={resolution.amount}
                  onChange={(e) => setResolution({ ...resolution, amount: e.target.value })}
                  placeholder="0.0"
                  step="0.01"
                />
              </FormControl>
            </VStack>
          </ModalBody>

          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={onClose}>
              Cancel
            </Button>
            <Button
              colorScheme="blue"
              onClick={handleResolveDispute}
              isLoading={resolving}
              loadingText="Resolving..."
            >
              Resolve
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
};

export default DisputeManager;