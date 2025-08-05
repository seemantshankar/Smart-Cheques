import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  FormControl,
  FormLabel,
  Input,
  VStack,
  Heading,
  useToast,
  NumberInput,
  NumberInputField,
  Divider,
  Text,
  IconButton,
  HStack,
  Textarea
} from '@chakra-ui/react';
import { AddIcon, DeleteIcon } from '@chakra-ui/icons';
import { useWeb3React } from '@web3-react/core';
import { ethers } from 'ethers';

interface Milestone {
  amount: string;
  description: string;
  obligation: string;
}

const CreateCheque = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const { account, provider } = useWeb3React();

  const [seller, setSeller] = useState('');
  const [milestones, setMilestones] = useState<Milestone[]>([{
    amount: '',
    description: '',
    obligation: ''
  }]);
  const [loading, setLoading] = useState(false);

  const addMilestone = () => {
    setMilestones([...milestones, { amount: '', description: '', obligation: '' }]);
  };

  const removeMilestone = (index: number) => {
    setMilestones(milestones.filter((_, i) => i !== index));
  };

  const updateMilestone = (index: number, field: keyof Milestone, value: string) => {
    const updatedMilestones = [...milestones];
    updatedMilestones[index] = { ...updatedMilestones[index], [field]: value };
    setMilestones(updatedMilestones);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!account || !provider) {
      toast({
        title: 'Error',
        description: 'Please connect your wallet first',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
      return;
    }

    try {
      setLoading(true);

      // Validate seller address
      if (!ethers.utils.isAddress(seller)) {
        throw new Error('Invalid seller address');
      }

      // Validate milestones
      if (milestones.length === 0) {
        throw new Error('At least one milestone is required');
      }

      const totalAmount = milestones.reduce(
        (sum, milestone) => sum.add(ethers.utils.parseEther(milestone.amount || '0')),
        ethers.BigNumber.from(0)
      );

      const milestoneAmounts = milestones.map(m => ethers.utils.parseEther(m.amount));
      const obligations = milestones.map(m => ethers.utils.id(m.obligation));

      // Get contract instance
      const factoryContract = new ethers.Contract(
        import.meta.env.VITE_FACTORY_ADDRESS!,
        ['function createCheque(address,address,uint256,uint256[],bytes32[]) returns (uint256)'],
        provider.getSigner()
      );

      // Create cheque
      const tx = await factoryContract.createCheque(
        account,
        seller,
        totalAmount,
        milestoneAmounts,
        obligations
      );

      const receipt = await tx.wait();
      const event = receipt.events?.find((e: any) => e.event === 'ChequeCreated');
      const chequeId = event?.args?.chequeId;

      // Save additional data to backend
      await fetch(`${import.meta.env.VITE_API_URL}/api/cheques/${chequeId}/metadata`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          milestones: milestones.map(m => ({
            description: m.description,
            obligation: m.obligation
          }))
        })
      });

      toast({
        title: 'Success',
        description: 'Smart Cheque created successfully',
        status: 'success',
        duration: 5000,
        isClosable: true,
      });

      navigate(`/cheques/${chequeId}`);
    } catch (error: any) {
      console.error('Error creating cheque:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to create Smart Cheque',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setLoading(false);
    }
  };

  if (!account) {
    return (
      <Box textAlign="center" py={10}>
        <Heading size="lg" mb={4}>
          Connect your wallet to create a Smart Cheque
        </Heading>
        <Text color="gray.500">
          You'll be able to create new Smart Cheques once your wallet is connected.
        </Text>
      </Box>
    );
  }

  return (
    <Box maxW="container.md" mx="auto">
      <Heading mb={8}>Create Smart Cheque</Heading>

      <form onSubmit={handleSubmit}>
        <VStack spacing={6} align="stretch">
          <FormControl isRequired>
            <FormLabel>Seller Address</FormLabel>
            <Input
              value={seller}
              onChange={(e) => setSeller(e.target.value)}
              placeholder="0x..."
            />
          </FormControl>

          <Divider />

          <Box>
            <Text fontSize="lg" fontWeight="bold" mb={4}>
              Milestones
            </Text>

            <VStack spacing={4} align="stretch">
              {milestones.map((milestone, index) => (
                <Box
                  key={index}
                  p={4}
                  borderWidth={1}
                  borderRadius="md"
                  position="relative"
                >
                  <HStack spacing={4} align="flex-start">
                    <VStack flex={1} spacing={4}>
                      <FormControl isRequired>
                        <FormLabel>Amount (ETH)</FormLabel>
                        <NumberInput
                          value={milestone.amount}
                          onChange={(value) => updateMilestone(index, 'amount', value)}
                          min={0}
                        >
                          <NumberInputField placeholder="0.0" />
                        </NumberInput>
                      </FormControl>

                      <FormControl isRequired>
                        <FormLabel>Description</FormLabel>
                        <Textarea
                          value={milestone.description}
                          onChange={(e) => updateMilestone(index, 'description', e.target.value)}
                          placeholder="Describe the milestone..."
                        />
                      </FormControl>

                      <FormControl isRequired>
                        <FormLabel>Obligation</FormLabel>
                        <Textarea
                          value={milestone.obligation}
                          onChange={(e) => updateMilestone(index, 'obligation', e.target.value)}
                          placeholder="Define the obligation..."
                        />
                      </FormControl>
                    </VStack>

                    {milestones.length > 1 && (
                      <IconButton
                        aria-label="Remove milestone"
                        icon={<DeleteIcon />}
                        onClick={() => removeMilestone(index)}
                        colorScheme="red"
                        variant="ghost"
                      />
                    )}
                  </HStack>
                </Box>
              ))}
            </VStack>

            <Button
              leftIcon={<AddIcon />}
              onClick={addMilestone}
              mt={4}
              size="sm"
              variant="ghost"
            >
              Add Milestone
            </Button>
          </Box>

          <Button
            type="submit"
            colorScheme="blue"
            size="lg"
            isLoading={loading}
            loadingText="Creating..."
          >
            Create Smart Cheque
          </Button>
        </VStack>
      </form>
    </Box>
  );
};

export default CreateCheque;