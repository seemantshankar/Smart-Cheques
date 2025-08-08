import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { Contract } from "ethers";

describe("DisputeManager - Multi-Arbitrator Support", function () {
    let disputeManager: Contract;
    let chequeFactory: Contract;
    let chequeEscrow: Contract;
    let token: Contract;
    let admin: SignerWithAddress;
    let buyer: SignerWithAddress;
    let arbitrator1: SignerWithAddress;
    let arbitrator2: SignerWithAddress;
    let arbitrator3: SignerWithAddress;
    let panelManager: SignerWithAddress;
    
    const ARBITRATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ARBITRATOR_ROLE"));
    const PANEL_MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PANEL_MANAGER_ROLE"));
    
    beforeEach(async function () {
        [admin, buyer, seller, arbitrator1, arbitrator2, arbitrator3, arbitrator4, arbitrator5, panelManager] = await ethers.getSigners();
        
        // Deploy a test ERC20 token
        const TokenFactory = await ethers.getContractFactory("MockERC20");
        token = await TokenFactory.deploy("Test Token", "TEST", ethers.parseEther("1000"));
        await token.waitForDeployment();
        
        // Transfer tokens to buyer for testing
        await token.transfer(buyer.target, ethers.parseEther("100"));
        
        // Deploy DisputeManager
        const DisputeManagerFactory = await ethers.getContractFactory("DisputeManager");
        disputeManager = await upgrades.deployProxy(DisputeManagerFactory, [admin.target], {
            initializer: 'initialize'
        });
        await disputeManager.waitForDeployment();
        
        // Deploy ChequeFactory
        const ChequeFactoryFactory = await ethers.getContractFactory("ChequeFactory");
        chequeFactory = await upgrades.deployProxy(ChequeFactoryFactory, [disputeManager.target, admin.target], {
            initializer: 'initialize'
        });
        await chequeFactory.waitForDeployment();
        
        // Deploy ChequeEscrow
        const ChequeEscrowFactory = await ethers.getContractFactory("ChequeEscrow");
        chequeEscrow = await upgrades.deployProxy(ChequeEscrowFactory, [chequeFactory.target, disputeManager.target, admin.target], {
            initializer: 'initialize'
        });
        await chequeEscrow.waitForDeployment();
        
        // Setup roles
        await disputeManager.grantRole(ARBITRATOR_ROLE, arbitrator1.target);
        await disputeManager.grantRole(ARBITRATOR_ROLE, arbitrator2.target);
        await disputeManager.grantRole(ARBITRATOR_ROLE, arbitrator3.target);
        await disputeManager.grantRole(PANEL_MANAGER_ROLE, panelManager.target);
        const totalAmount = ethers.parseEther("50");
        await token.connect(buyer).approve(await chequeEscrow.getAddress(), totalAmount);
        await chequeEscrow.connect(buyer).lockFunds(await token.getAddress(), totalAmount);
        // Grant roles to arbitrators
        await disputeManager.grantRole(ARBITRATOR_ROLE, arbitrator1.target);
        await disputeManager.grantRole(ARBITRATOR_ROLE, arbitrator2.target);
        await disputeManager.grantRole(ARBITRATOR_ROLE, arbitrator3.target);
        await disputeManager.grantRole(PANEL_MANAGER_ROLE, panelManager.target);
    });
    
    describe("Panel Configuration", function () {
        it("Should allow panel manager to configure arbitrator panels", async function () {
            const panelId = ethers.keccak256(ethers.toUtf8Bytes("panel1"));
            const arbitrators = [arbitrator1.target, arbitrator2.target, arbitrator3.target];
            const threshold = 2;
            
            await expect(
                disputeManager.connect(panelManager).configurePanelArbitrators(
                    panelId,
                    arbitrators,
                    threshold
                )
            ).to.emit(disputeManager, "PanelConfigured")
             .withArgs(panelId, arbitrators, threshold);
            
            const [configArbitrators, configThreshold, isActive] = await disputeManager.getPanelConfig(panelId);
            expect(configArbitrators).to.deep.equal(arbitrators);
            expect(configThreshold).to.equal(threshold);
            expect(isActive).to.be.true;
        });
        
        it("Should reject panel configuration with invalid threshold", async function () {
            const panelId = ethers.keccak256(ethers.toUtf8Bytes("panel1"));
            const arbitrators = [arbitrator1.target, arbitrator2.target];
            const threshold = 3; // Higher than number of arbitrators
            
            await expect(
                disputeManager.connect(panelManager).configurePanelArbitrators(
                    panelId,
                    arbitrators,
                    threshold
                )
            ).to.be.revertedWith("Threshold too high");
        });
        
        it("Should reject panel configuration from non-panel manager", async function () {
            const panelId = ethers.keccak256(ethers.toUtf8Bytes("panel1"));
            const arbitrators = [arbitrator1.target, arbitrator2.target];
            const threshold = 2;
            
            await expect(
                disputeManager.connect(buyer).configurePanelArbitrators(
                    panelId,
                    arbitrators,
                    threshold
                )
            ).to.be.reverted;
        });
    });
    
    describe("Multi-Arbitrator Dispute Escalation", function () {
        let disputeId: string;
        let panelId: string;
        
        beforeEach(async function () {
            // Create a dispute
            const tx = await disputeManager.connect(buyer).openDispute(
                await chequeEscrow.getAddress(),
                0,
                "Quality issues",
                "0x1234"
            );
            const receipt = await tx.wait();
            const event = receipt?.logs?.find((log: any) => log.fragment?.name === "DisputeOpened");
            disputeId = event?.args?.disputeId;
            
            // Configure a panel
            panelId = ethers.keccak256(ethers.toUtf8Bytes("panel1"));
            await disputeManager.connect(panelManager).configurePanelArbitrators(
                panelId,
                [arbitrator1.target, arbitrator2.target, arbitrator3.target],
                2
            );
        });
        
        it("Should escalate dispute to multi-arbitrator panel", async function () {
            await expect(
                disputeManager.connect(buyer).escalateDisputeToPanel(disputeId, panelId)
            ).to.emit(disputeManager, "PanelAssigned")
             .withArgs(disputeId, [arbitrator1.target, arbitrator2.target, arbitrator3.target], 2);
            
            const [panel, requiredVotes] = await disputeManager.getDisputePanel(disputeId);
            expect(panel).to.deep.equal([arbitrator1.target, arbitrator2.target, arbitrator3.target]);
            expect(requiredVotes).to.equal(2);
        });
        
        it("Should reject escalation to inactive panel", async function () {
            await disputeManager.connect(panelManager).deactivatePanel(panelId);
            
            await expect(
                disputeManager.connect(buyer).escalateDisputeToPanel(disputeId, panelId)
            ).to.be.revertedWith("Panel not active");
        });
    });
    
    describe("Multi-Arbitrator Voting", function () {
        let disputeId: string;
        
        beforeEach(async function () {
            // Raise dispute on the escrow contract first
            await chequeEscrow.connect(buyer).raiseDispute(0);
            
            // Create and escalate dispute
            const tx = await disputeManager.connect(buyer).openDispute(
                chequeEscrow.address,
                0,
                "Quality issues",
                "0x1234"
            );
            const receipt = await tx.wait();
            const event = receipt.events?.find((e: any) => e.event === "DisputeOpened");
            disputeId = event?.args?.disputeId;
            
            const panelId = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("panel1"));
            await disputeManager.connect(panelManager).configurePanelArbitrators(
                panelId,
                [arbitrator1.address, arbitrator2.address, arbitrator3.address],
                2
            );
            
            await disputeManager.connect(buyer).escalateDisputeToPanel(disputeId, panelId);
        });
        
        it("Should allow arbitrators to submit votes", async function () {
            const ResolutionType = { None: 0, ReleaseFunds: 1, RefundBuyer: 2, PartialRelease: 3 };
            
            await expect(
                disputeManager.connect(arbitrator1).submitArbitratorVote(
                    disputeId,
                    ResolutionType.ReleaseFunds,
                    0
                )
            ).to.emit(disputeManager, "ArbitratorVoteSubmitted")
             .withArgs(disputeId, arbitrator1.target, ResolutionType.ReleaseFunds, 0);
            
            const [resolutionType, amount, hasVoted] = await disputeManager.getArbitratorVote(
                disputeId,
                arbitrator1.address
            );
            expect(resolutionType).to.equal(ResolutionType.ReleaseFunds);
            expect(amount).to.equal(0);
            expect(hasVoted).to.be.true;
        });
        
        it("Should reach quorum and auto-resolve dispute", async function () {
            const ResolutionType = { None: 0, ReleaseFunds: 1, RefundBuyer: 2, PartialRelease: 3 };
            
            // First vote
            await disputeManager.connect(arbitrator1).submitArbitratorVote(
                disputeId,
                ResolutionType.ReleaseFunds,
                0
            );
            
            // Second vote (reaches quorum)
            await expect(
                disputeManager.connect(arbitrator2).submitArbitratorVote(
                    disputeId,
                    ResolutionType.ReleaseFunds,
                    0
                )
            ).to.emit(disputeManager, "QuorumReached")
             .withArgs(disputeId, ResolutionType.ReleaseFunds, 0)
             .and.to.emit(disputeManager, "DisputeResolved")
             .withArgs(disputeId, ResolutionType.ReleaseFunds, 0);
            
            const [, , , , status] = await disputeManager.getDispute(disputeId);
            expect(status).to.equal(4); // DisputeStatus.Resolved
        });
        
        it("Should prevent double voting", async function () {
            const ResolutionType = { None: 0, ReleaseFunds: 1, RefundBuyer: 2, PartialRelease: 3 };
            
            await disputeManager.connect(arbitrator1).submitArbitratorVote(
                disputeId,
                ResolutionType.ReleaseFunds,
                0
            );
            
            await expect(
                disputeManager.connect(arbitrator1).submitArbitratorVote(
                    disputeId,
                    ResolutionType.RefundBuyer,
                    0
                )
            ).to.be.revertedWith("Already voted");
        });
        
        it("Should prevent voting from non-panel arbitrators", async function () {
            const ResolutionType = { None: 0, ReleaseFunds: 1, RefundBuyer: 2, PartialRelease: 3 };
            
            // Grant arbitrator role to a new address but don't add to panel
            const [, , , , , , , newArbitrator] = await ethers.getSigners();
            await disputeManager.grantRole(ARBITRATOR_ROLE, newArbitrator.address);
            
            await expect(
                disputeManager.connect(newArbitrator).submitArbitratorVote(
                    disputeId,
                    ResolutionType.ReleaseFunds,
                    0
                )
            ).to.be.revertedWith("Not in assigned panel");
        });
    });
    
    describe("Vote Counting and Averaging", function () {
        let disputeId: string;
        
        beforeEach(async function () {
            // Create and escalate dispute
            const tx = await disputeManager.connect(buyer).openDispute(
                chequeEscrow.address,
                0,
                "Quality issues",
                "0x1234"
            );
            const receipt = await tx.wait();
            const event = receipt.events?.find((e: any) => e.event === "DisputeOpened");
            disputeId = event?.args?.disputeId;
            
            const panelId = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("panel1"));
            await disputeManager.connect(panelManager).configurePanelArbitrators(
                panelId,
                [arbitrator1.address, arbitrator2.address, arbitrator3.address],
                2
            );
            
            await disputeManager.connect(buyer).escalateDisputeToPanel(disputeId, panelId);
        });
        
        it("Should correctly count votes and calculate average amounts", async function () {
            const ResolutionType = { None: 0, ReleaseFunds: 1, RefundBuyer: 2, PartialRelease: 3 };
            
            // Submit votes with different amounts for partial release
            await disputeManager.connect(arbitrator1).submitArbitratorVote(
                disputeId,
                ResolutionType.PartialRelease,
                ethers.utils.parseEther("0.3")
            );
            
            await disputeManager.connect(arbitrator2).submitArbitratorVote(
                disputeId,
                ResolutionType.PartialRelease,
                ethers.utils.parseEther("0.5")
            );
            
            // Check vote counts
            const [releaseFunds, refundBuyer, partialRelease] = await disputeManager.getDisputeVoteCounts(disputeId);
            expect(releaseFunds).to.equal(0);
            expect(refundBuyer).to.equal(0);
            expect(partialRelease).to.equal(2);
            
            // The dispute should be resolved with average amount
            const [, , , , , proposedResolution, proposedAmount] = await disputeManager.getDispute(disputeId);
            expect(proposedResolution).to.equal(ResolutionType.PartialRelease);
            expect(proposedAmount).to.equal(ethers.utils.parseEther("0.4")); // Average of 0.3 and 0.5
        });
    });
    
    describe("Backward Compatibility", function () {
        it("Should maintain legacy single arbitrator escalation", async function () {
            const tx = await disputeManager.connect(buyer).openDispute(
                chequeEscrow.address,
                0,
                "Quality issues",
                "0x1234"
            );
            const receipt = await tx.wait();
            const event = receipt.events?.find((e: any) => e.event === "DisputeOpened");
            const disputeId = event?.args?.disputeId;
            
            await expect(
                disputeManager.connect(buyer).escalateDispute(disputeId, arbitrator1.address)
            ).to.emit(disputeManager, "DisputeEscalated")
             .withArgs(disputeId, arbitrator1.address);
            
            const [, , , , , , , arbitrator] = await disputeManager.getDispute(disputeId);
            expect(arbitrator).to.equal(arbitrator1.address);
        });
    });
});