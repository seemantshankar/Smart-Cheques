import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Box,
  VStack,
  HStack,
  Heading,
  Text,
  Button,
  Badge,
  Progress,
  useToast,
  Divider,
  SimpleGrid,
  Textarea,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
  Skeleton
} from '@chakra-ui/react';
import { useWeb3React } from '@web3-react/core';
import { ethers } from 'ethers';

interface Milestone {
  amount: string;
  description: string;
  obligation: string;
  isCompleted: boolean;
  proof?: string;
}

interface Cheque {
  id: string;
  address: string;
  buyer: string;
  seller: string;
  totalAmount: string;
  status: string;
  milestones: Milestone[];
}

const ChequeDetails = () => {
  const { id } = useParams<{ id: string }>();
  const { account, library } = useWeb3React();
  const toast = useToast();
  const { isOpen, onOpen, onClose } = useDisclosure();

  const [cheque, setCheque] = useState<Cheque | null>(null);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [selectedMilestone, setSelectedMilestone] = useState<number | null>(null);
  const [proof, setProof] = useState('');

  useEffect(() => {
    fetchChequeDetails();
  }, [id, account, library]);

  const fetchChequeDetails = async () => {
    if (!id || !library) return;

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/cheques/${id}`);
      const data = await response.json();

      if (data.success) {
        setCheque(data.cheque);
      }
    } catch (error) {
      console.error('Error fetching cheque details:', error);
      toast({
        title: 'Error',
        description: 'Failed to load cheque details',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteMilestone = async () => {
    if (!cheque || selectedMilestone === null || !library || !account) return;

    try {
      setCompleting(true);

      const chequeContract = new ethers.Contract(
        cheque.address,
        ['function completeMilestone(uint256,bytes) returns (bool)'],
        library.getSigner()
      );

      const tx = await chequeContract.completeMilestone(
        selectedMilestone,
        ethers.utils.toUtf8Bytes(proof)
      );

      await tx.wait();

      toast({
        title: 'Success',
        description: 'Milestone completed successfully',
        status: 'success',
        duration: 5000,
        isClosable: true,
      });

      onClose();
      fetchChequeDetails();
    } catch (error: any) {
      console.error('Error completing milestone:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to complete milestone',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setCompleting(false);
    }
  };

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

  const openCompleteMilestoneModal = (index: number) => {
    setSelectedMilestone(index);
    setProof('');
    onOpen();
  };

  if (loading) {
    return (
      <VStack spacing={8}>
        <Skeleton height="40px" width="200px" />
        <Skeleton height="200px" width="100%" />
        <Skeleton height="300px" width="100%" />
      </VStack>
    );
  }

  if (!cheque) {
    return (
      <Box textAlign="center" py={10}>
        <Heading size="lg">Cheque not found</Heading>
      </Box>
    );
  }

  const completedMilestones = cheque.milestones.filter(m => m.isCompleted).length;
  const progress = (completedMilestones / cheque.milestones.length) * 100;

  return (
    <Box>
      <VStack spacing={8} align="stretch">
        <HStack justify="space-between">
          <Heading>Smart Cheque #{cheque.id}</Heading>
          {getStatusBadge(cheque.status)}
        </HStack>

        <SimpleGrid columns={{ base: 1, md: 2 }} spacing={6}>
          <Box>
            <Text color="gray.500">Buyer</Text>
            <Text fontSize="sm" wordBreak="break-all">
              {cheque.buyer}
            </Text>
          </Box>

          <Box>
            <Text color="gray.500">Seller</Text>
            <Text fontSize="sm" wordBreak="break-all">
              {cheque.seller}
            </Text>
          </Box>
        </SimpleGrid>

        <Box>
          <Text color="gray.500">Contract Address</Text>
          <Text fontSize="sm" wordBreak="break-all">
            {cheque.address}
          </Text>
        </Box>

        <Box>
          <Text color="gray.500" mb={2}>Progress</Text>
          <Progress
            value={progress}
            size="lg"
            colorScheme="blue"
            borderRadius="md"
          />
          <Text mt={2} fontSize="sm" color="gray.500" textAlign="right">
            {completedMilestones} of {cheque.milestones.length} milestones completed
          </Text>
        </Box>

        <Divider />

        <Box>
          <Heading size="md" mb={4}>Milestones</Heading>
          <VStack spacing={4} align="stretch">
            {cheque.milestones.map((milestone, index) => (
              <Box
                key={index}
                p={4}
                borderWidth={1}
                borderRadius="md"
                bg={milestone.isCompleted ? 'green.50' : 'white'}
              >
                <HStack justify="space-between" mb={2}>
                  <Text fontWeight="bold">
                    Milestone {index + 1}
                  </Text>
                  <Badge colorScheme={milestone.isCompleted ? 'green' : 'gray'}>
                    {milestone.isCompleted ? 'Completed' : 'Pending'}
                  </Badge>
                </HStack>

                <Text color="gray.500" fontSize="sm" mb={2}>
                  Amount: {ethers.utils.formatEther(milestone.amount)} ETH
                </Text>

                <Text fontSize="sm" mb={2}>
                  {milestone.description}
                </Text>

                <Text color="gray.500" fontSize="sm" mb={2}>
                  Obligation: {milestone.obligation}
                </Text>

                {milestone.proof && (
                  <Text color="gray.500" fontSize="sm" mb={2}>
                    Proof: {milestone.proof}
                  </Text>
                )}

                {!milestone.isCompleted && account === cheque.seller && (
                  <Button
                    size="sm"
                    colorScheme="blue"
                    onClick={() => openCompleteMilestoneModal(index)}
                  >
                    Complete Milestone
                  </Button>
                )}
              </Box>
            ))}
          </VStack>
        </Box>
      </VStack>

      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Complete Milestone</ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <Text>Please provide proof of completion for this milestone:</Text>
              <Textarea
                value={proof}
                onChange={(e) => setProof(e.target.value)}
                placeholder="Describe how you completed this milestone..."
              />
            </VStack>
          </ModalBody>

          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={onClose}>
              Cancel
            </Button>
            <Button
              colorScheme="blue"
              onClick={handleCompleteMilestone}
              isLoading={completing}
              loadingText="Completing..."
            >
              Submit
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
};

export default ChequeDetails;