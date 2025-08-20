import { ethers } from "hardhat";

async function main() {
  const governorAddress = process.env.GOVERNOR_ADDRESS as string;
  const target = process.env.TARGET as string; // proxy address
  const calldataHex = process.env.CALLDATA as string; // encoded fn data
  const description = process.env.DESCRIPTION as string;
  if (!governorAddress || !target || !calldataHex || !description) {
    throw new Error("Missing env: GOVERNOR_ADDRESS, TARGET, CALLDATA, DESCRIPTION");
  }
  const values = [0];
  const targets = [target];
  const calldatas = [calldataHex];
  const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description));
  const governor = await ethers.getContractAt("SmartChequeGovernor", governorAddress);
  console.log("Queueing...");
  await (await governor.queue(targets, values, calldatas, descriptionHash)).wait();
  console.log("Queued. Waiting for delay externally, then executing...");
  await (await governor.execute(targets, values, calldatas, descriptionHash)).wait();
  console.log("Executed.");
}

main().catch((e) => { console.error(e); process.exit(1); });


