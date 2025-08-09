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
  isDisputed?: boolean;
  proof?: string;
  verification?: 'pending' | 'verified';
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
  const { account, provider } = useWeb3React();
  const toast = useToast();
  const { isOpen, onOpen, onClose } = useDisclosure();

  const [cheque, setCheque] = useState<Cheque | null>(null);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [selectedMilestone, setSelectedMilestone] = useState<number | null>(null);
  const [proof, setProof] = useState('');
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [disputeEvidence, setDisputeEvidence] = useState('');

  useEffect(() => {
    fetchChequeDetails();
  }, [id, account, provider]);

  const fetchChequeDetails = async () => {
    if (!id || !provider) return;

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

  const handleCompleteMilestone = async (): Promise<void> => {
    if (!cheque || selectedMilestone === null || !provider || !account) return;

    try {
      setCompleting(true);

      const signer = await provider.getSigner();
      const chequeContract = new ethers.Contract(
        cheque.address,
        ['function completeMilestone(uint256,bytes) returns (bool)'],
        signer as any
      );

      const tx = await chequeContract.completeMilestone(
        selectedMilestone,
        ethers.toUtf8Bytes(proof)
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
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to complete milestone';
      console.error('Error completing milestone:', error);
      toast({
        title: 'Error',
        description: errorMessage,
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

  const handleOpenDispute = async () => {
    if (!cheque || selectedMilestone === null) return;
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/disputes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chequeAddress: cheque.address,
          milestoneId: selectedMilestone,
          reason: disputeReason,
          evidence: disputeEvidence
        })
      });
      if (!res.ok) throw new Error('Failed to open dispute');
      toast({ title: 'Dispute opened', status: 'success', duration: 4000, isClosable: true });
      setDisputeOpen(false);
      setDisputeReason('');
      setDisputeEvidence('');
      fetchChequeDetails();
    } catch (e) {
      toast({ title: 'Error', description: 'Failed to open dispute', status: 'error', duration: 5000, isClosable: true });
    }
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

  const completedMilestones = cheque.milestones.filter((m: Milestone) => m.isCompleted).length;
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
            {cheque.milestones.map((milestone: Milestone, index: number) => (
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
                  Amount: {ethers.formatEther(milestone.amount)} ETH
                </Text>

                <Text fontSize="sm" mb={2}>
                  {milestone.description}
                </Text>

                <Text color="gray.500" fontSize="sm" mb={2}>
                  Obligation: {milestone.obligation}
                </Text>

                <Text color={milestone.verification === 'verified' ? 'green.600' : 'yellow.600'} fontSize="sm" mb={2}>
                  Verification: {milestone.verification === 'verified' ? 'Verified' : 'Pending'}
                </Text>

                {milestone.proof && (
                  <Text color="gray.500" fontSize="sm" mb={2}>
                    Proof: {milestone.proof}
                  </Text>
                )}

                {!milestone.isCompleted && account === cheque.seller && !milestone.isDisputed && (
                  <Button
                    size="sm"
                    colorScheme="blue"
                    onClick={() => openCompleteMilestoneModal(index)}
                  >
                    Complete Milestone
                  </Button>
                )}

                {!milestone.isCompleted && !milestone.isDisputed && account === cheque.buyer && (
                  <Button
                    ml={2}
                    size="sm"
                    colorScheme="red"
                    onClick={() => { setSelectedMilestone(index); setDisputeOpen(true);} }
                  >
                    Raise Dispute
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
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setProof(e.target.value)}
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

      <Modal isOpen={disputeOpen} onClose={() => setDisputeOpen(false)}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Open Dispute</ModalHeader>
          <ModalBody>
            <VStack spacing={4} align="stretch">
              <Textarea
                value={disputeReason}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDisputeReason(e.target.value)}
                placeholder="Reason for dispute"
              />
              <Textarea
                value={disputeEvidence}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDisputeEvidence(e.target.value)}
                placeholder="Evidence (links, notes, etc.)"
              />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={() => setDisputeOpen(false)}>
              Cancel
            </Button>
            <Button colorScheme="red" onClick={handleOpenDispute}>Submit</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
};

export default ChequeDetails;