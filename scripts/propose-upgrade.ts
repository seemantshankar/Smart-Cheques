import { ethers } from "hardhat";

async function main() {
  const governorAddress = process.env.GOVERNOR_ADDRESS as string;
  const proxyAddress = process.env.PROXY_ADDRESS as string;
  const newImplementation = process.env.IMPLEMENTATION_ADDRESS as string;
  const description = process.env.DESCRIPTION || `Upgrade ${proxyAddress} to ${newImplementation}`;

  if (!governorAddress || !proxyAddress || !newImplementation) {
    throw new Error("Missing env: GOVERNOR_ADDRESS, PROXY_ADDRESS, IMPLEMENTATION_ADDRESS, DESCRIPTION(optional)");
  }

  const governor = await ethers.getContractAt("SmartChequeGovernor", governorAddress);
  const iface = new ethers.Interface(["function upgradeTo(address newImplementation)"]);
  const calldata = iface.encodeFunctionData("upgradeTo", [newImplementation]);

  const tx = await governor.propose([proxyAddress], [0], [calldata], description);
  const receipt = await tx.wait();
  const log = receipt.logs?.map((l: any) => {
    try { return governor.interface.parseLog(l); } catch { return null; }
  }).find((e: any) => e && e.name === "ProposalCreated");
  const proposalId = log?.args?.proposalId?.toString();
  console.log("Proposed upgrade. ProposalId=", proposalId);
}

main().catch((e) => { console.error(e); process.exit(1); });


