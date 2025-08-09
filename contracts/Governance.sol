// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0
pragma solidity ^0.8.24;

import {Governor} from "@openzeppelin/contracts/governance/Governor.sol";
import {GovernorCountingSimple} from "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import {GovernorSettings} from "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import {GovernorTimelockControl} from "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";
import {GovernorVotes} from "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import {GovernorVotesQuorumFraction} from "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

contract SmartChequeGovernor is Governor, GovernorSettings, GovernorCountingSimple, GovernorVotes, GovernorVotesQuorumFraction, GovernorTimelockControl {
    // Custom errors
    error EmptyTargetsArray();
    error TargetsValuesLengthMismatch();
    error TargetsCalldatasLengthMismatch();
    error EmptyDescription();
    error ProposalCreationFailed();
    constructor(IVotes _token, TimelockController _timelock)
        Governor("SmartChequeGovernor")
        GovernorSettings(1 /* 1 block */, 5 /* 5 blocks */, 0)
        GovernorVotes(_token)
        GovernorVotesQuorumFraction(4)
        GovernorTimelockControl(_timelock)
    {}

    // Custom functions for emergency proposals
    function proposeEmergency(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) public returns (uint256) {
        return propose(targets, values, calldatas, description);
    }

    function proposeWithMetadata(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description,
        uint256 category,
        string memory metadata
    ) public returns (uint256) {
        // For now, just append metadata to description
        string memory fullDescription = string(abi.encodePacked(description, "\n\nCategory: ", category, "\n\nMetadata: ", metadata));
        return propose(targets, values, calldatas, fullDescription);
    }

    // The following functions are overrides required by Solidity.

    function state(uint256 proposalId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (ProposalState)
    {
        return super.state(proposalId);
    }



    function _execute(uint256 proposalId, address[] memory targets, uint256[] memory values, bytes[] memory calldatas, bytes32 descriptionHash)
        internal
        override(Governor, GovernorTimelockControl)
    {
        super._execute(proposalId, targets, values, calldatas, descriptionHash);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function proposalThreshold()
        public
        view
        override(Governor, GovernorSettings)
        returns (uint256)
    {
        return super.proposalThreshold();
    }



    function _cancel(address[] memory targets, uint256[] memory values, bytes[] memory calldatas, bytes32 descriptionHash)
        internal
        override(Governor, GovernorTimelockControl)
        returns (uint256)
    {
        return super._cancel(targets, values, calldatas, descriptionHash);
    }

    function _executor()
        internal
        view
        override(Governor, GovernorTimelockControl)
        returns (address)
    {
        return super._executor();
    }
    
    /**
     * @dev Check if a proposal exists
     * @param proposalId The proposal ID to check
     * @return bool True if proposal exists
     */
    function proposalExists(uint256 proposalId) public view returns (bool) {
        return state(proposalId) != ProposalState.Pending || 
               proposalSnapshot(proposalId) > 0;
    }
    
    /**
     * @dev Get proposal details for debugging
     * @param proposalId The proposal ID
     * @return state_ Current state of the proposal
     * @return snapshot Snapshot block number
     * @return deadline Voting deadline
     */
    function getProposalDetails(uint256 proposalId) 
        public 
        view 
        returns (
            ProposalState state_,
            uint256 snapshot,
            uint256 deadline
        ) 
    {
        state_ = state(proposalId);
        snapshot = proposalSnapshot(proposalId);
        deadline = proposalDeadline(proposalId);
    }
    
    /**
     * @dev Enhanced proposal creation with validation
     * @param targets Target addresses
     * @param values Values to send
     * @param calldatas Function call data
     * @param description Proposal description
     * @return proposalId The created proposal ID
     */
    function proposeWithValidation(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) public returns (uint256 proposalId) {
        if (targets.length == 0) revert EmptyTargetsArray();
        if (targets.length != values.length) revert TargetsValuesLengthMismatch();
        if (targets.length != calldatas.length) revert TargetsCalldatasLengthMismatch();
        if (bytes(description).length == 0) revert EmptyDescription();
        
        proposalId = propose(targets, values, calldatas, description);
        
        // Verify proposal was created successfully
        if (!proposalExists(proposalId)) revert ProposalCreationFailed();
        
        return proposalId;
    }
}